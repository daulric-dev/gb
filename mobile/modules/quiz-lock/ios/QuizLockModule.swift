import ExpoModulesCore
import UIKit

/**
 Lockdown quiz helpers on iOS.

 "Pinned" is Guided Access. An app can only start or end a Guided Access
 session itself on a supervised device whose MDM profile allows it for
 Autonomous Single App Mode; everywhere else the student triple-clicks the
 side (or home) button. "Captured" is screen recording, AirPlay mirroring or
 a wired mirror (UIScreen.isCaptured).

 UIKit state is read on the main thread and cached so the synchronous
 getters never block the JS thread on the main queue.
 */
public class QuizLockModule: Module {
  private var pinned = false
  private var captured = false
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("QuizLock")

    Events("onPinnedChange", "onCaptureChange")

    OnCreate {
      DispatchQueue.main.async {
        self.refresh(notify: false)
      }
    }

    OnStartObserving {
      DispatchQueue.main.async {
        self.startObserving()
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        self.stopObserving()
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.stopObserving()
      }
    }

    Function("isPinned") { () -> Bool in
      return self.pinned
    }

    Function("isScreenCaptured") { () -> Bool in
      return self.captured
    }

    AsyncFunction("getStatusAsync") { () -> [String: Bool] in
      self.refresh(notify: false)
      return ["pinned": self.pinned, "captured": self.captured]
    }.runOnQueue(.main)

    AsyncFunction("startPinning") { (promise: Promise) in
      if UIAccessibility.isGuidedAccessEnabled {
        self.refresh(notify: true)
        promise.resolve(true)
        return
      }
      // Succeeds only on a supervised device with this app allowed for
      // Autonomous Single App Mode; otherwise false, at once.
      UIAccessibility.requestGuidedAccessSession(enabled: true) { didSucceed in
        DispatchQueue.main.async {
          self.refresh(notify: true)
          promise.resolve(didSucceed && UIAccessibility.isGuidedAccessEnabled)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("stopPinning") { (promise: Promise) in
      if !UIAccessibility.isGuidedAccessEnabled {
        self.refresh(notify: true)
        promise.resolve(true)
        return
      }
      // A session the student started with the triple-click cannot be ended
      // here; they triple-click again and enter the Guided Access passcode.
      UIAccessibility.requestGuidedAccessSession(enabled: false) { _ in
        DispatchQueue.main.async {
          self.refresh(notify: true)
          promise.resolve(!UIAccessibility.isGuidedAccessEnabled)
        }
      }
    }.runOnQueue(.main)
  }

  private func startObserving() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    let names: [Notification.Name] = [
      UIAccessibility.guidedAccessStatusDidChangeNotification,
      UIScreen.capturedDidChangeNotification,
      UIApplication.didBecomeActiveNotification,
    ]
    observers = names.map { name in
      center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.refresh(notify: true)
      }
    }
    refresh(notify: true)
  }

  private func stopObserving() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }

  private func currentCaptured() -> Bool {
    if let screen = keyWindow()?.screen {
      return screen.isCaptured
    }
    return UIScreen.main.isCaptured
  }

  private func keyWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  /** Main thread only. */
  private func refresh(notify: Bool) {
    let nowPinned = UIAccessibility.isGuidedAccessEnabled
    let nowCaptured = currentCaptured()
    let pinnedChanged = nowPinned != pinned
    let capturedChanged = nowCaptured != captured
    pinned = nowPinned
    captured = nowCaptured
    guard notify else { return }
    if pinnedChanged {
      sendEvent("onPinnedChange", ["pinned": nowPinned])
    }
    if capturedChanged {
      sendEvent("onCaptureChange", ["captured": nowCaptured])
    }
  }
}
