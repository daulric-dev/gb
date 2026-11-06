package expo.modules.quizlock

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.function.Consumer

/**
 * Lockdown quiz helpers on Android.
 *
 * "Pinned" is lock task mode: screen pinning (the system "Pin this app?"
 * prompt an ordinary app gets from startLockTask) or a device-owner
 * allowlisted lock task. There is no broadcast for it, so the state is polled
 * while JS listens and re-read whenever the activity returns to the
 * foreground. "Captured" is Android 15+ screen recording of this app's
 * windows (WindowManager.addScreenRecordingCallback).
 */
class QuizLockModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var observing = false
  private var lastPinned: Boolean? = null
  @Volatile private var captured = false
  private var recordingActivity: Activity? = null
  private var recordingCallback: Consumer<Int>? = null

  private val poll = object : Runnable {
    override fun run() {
      if (!observing) return
      checkPinned()
      handler.postDelayed(this, POLL_MS)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("QuizLock")

    Events("onPinnedChange", "onCaptureChange")

    OnStartObserving {
      handler.post {
        if (observing) return@post
        observing = true
        lastPinned = readPinned()
        handler.postDelayed(poll, POLL_MS)
        registerRecordingCallback()
      }
    }

    OnStopObserving {
      handler.post {
        observing = false
        handler.removeCallbacks(poll)
        unregisterRecordingCallback()
      }
    }

    OnActivityEntersForeground {
      handler.post {
        if (!observing) return@post
        checkPinned()
        // The activity may have been recreated; follow the new one.
        if (appContext.currentActivity !== recordingActivity) {
          unregisterRecordingCallback()
          registerRecordingCallback()
        }
      }
    }

    OnDestroy {
      handler.post {
        observing = false
        handler.removeCallbacks(poll)
        unregisterRecordingCallback()
      }
    }

    Function("isPinned") {
      readPinned()
    }

    Function("isScreenCaptured") {
      captured
    }

    AsyncFunction("getStatusAsync") {
      mapOf("pinned" to readPinned(), "captured" to captured)
    }

    AsyncFunction("startPinning") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      if (readPinned()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      try {
        activity.startLockTask()
      } catch (e: Exception) {
        promise.resolve(false)
        return@AsyncFunction
      }
      awaitPinConfirmation(activity, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopPinning") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity != null && readPinned()) {
        try {
          activity.stopLockTask()
        } catch (e: Exception) {
          // Not pinned by this activity; nothing to release.
        }
      }
      // stopLockTask settles asynchronously.
      handler.postDelayed({
        checkPinned()
        promise.resolve(!readPinned())
      }, SETTLE_MS)
    }.runOnQueue(Queues.MAIN)
  }

  private fun activityManager(): ActivityManager? =
    appContext.reactContext?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager

  private fun readPinned(): Boolean {
    val manager = activityManager() ?: return false
    return manager.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
  }

  private fun checkPinned() {
    val now = readPinned()
    if (now != lastPinned) {
      lastPinned = now
      if (observing) sendEvent("onPinnedChange", mapOf("pinned" to now))
    }
  }

  /**
   * An ordinary app gets the system "Pin this app?" prompt, which takes
   * window focus; a device-owner allowlisted app pins at once. Resolve true
   * once pinned, false when the prompt is dismissed without pinning (focus
   * returns unpinned), or on timeout.
   */
  private fun awaitPinConfirmation(activity: Activity, promise: Promise) {
    val started = System.currentTimeMillis()
    var lostFocus = false
    var unpinnedSince = 0L
    val tick = object : Runnable {
      override fun run() {
        checkPinned()
        if (readPinned()) {
          promise.resolve(true)
          return
        }
        val now = System.currentTimeMillis()
        val elapsed = now - started
        val focused = activity.hasWindowFocus()
        if (!focused) {
          lostFocus = true
          unpinnedSince = 0L
        } else if (lostFocus || elapsed > NO_PROMPT_MS) {
          // Prompt dismissed (or never shown); give the pin a moment to land.
          if (unpinnedSince == 0L) unpinnedSince = now
          if (now - unpinnedSince >= SETTLE_MS) {
            promise.resolve(false)
            return
          }
        }
        if (elapsed > CONFIRM_TIMEOUT_MS || activity.isFinishing) {
          promise.resolve(readPinned())
          return
        }
        handler.postDelayed(this, CONFIRM_POLL_MS)
      }
    }
    handler.postDelayed(tick, CONFIRM_POLL_MS)
  }

  private fun registerRecordingCallback() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return
    if (recordingCallback != null) return
    val activity = appContext.currentActivity ?: return
    val callback = Consumer<Int> { state ->
      handler.post { setCaptured(state == WindowManager.SCREEN_RECORDING_STATE_VISIBLE) }
    }
    try {
      val initial = activity.windowManager.addScreenRecordingCallback(activity.mainExecutor, callback)
      recordingActivity = activity
      recordingCallback = callback
      setCaptured(initial == WindowManager.SCREEN_RECORDING_STATE_VISIBLE)
    } catch (e: SecurityException) {
      // DETECT_SCREEN_RECORDING missing from the merged manifest.
    }
  }

  private fun unregisterRecordingCallback() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return
    val activity = recordingActivity
    val callback = recordingCallback
    recordingActivity = null
    recordingCallback = null
    if (activity != null && callback != null) {
      try {
        activity.windowManager.removeScreenRecordingCallback(callback)
      } catch (e: Exception) {
        // Window already gone.
      }
    }
    setCaptured(false)
  }

  private fun setCaptured(now: Boolean) {
    if (now == captured) return
    captured = now
    if (observing) sendEvent("onCaptureChange", mapOf("captured" to now))
  }

  companion object {
    private const val POLL_MS = 1000L
    private const val CONFIRM_POLL_MS = 200L
    private const val SETTLE_MS = 600L
    private const val NO_PROMPT_MS = 2500L
    private const val CONFIRM_TIMEOUT_MS = 60_000L
  }
}
