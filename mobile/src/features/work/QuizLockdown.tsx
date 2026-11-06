import { Modal, StyleSheet, View } from "react-native";
import { Pin, ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import type { QuizAwayReason } from "@/lib/work";

export type PinningPlatform = "ios" | "android" | null;

/** How to pin, in the student's words, per platform. */
function PinningSteps({ platform }: { platform: PinningPlatform }) {
  if (platform === "ios") {
    return (
      <View style={{ gap: 4 }}>
        <Text size="sm" weight="500">
          Turn on Guided Access
        </Text>
        <Text variant="muted" size="sm">
          Triple-click the side button (or the Home button) and tap Start to
          turn on Guided Access.
        </Text>
        <Text variant="muted" size="xs">
          First time? Guided Access must be turned on once in Settings {">"}{" "}
          Accessibility {">"} Guided Access, with a passcode you will need to
          end it after the quiz.
        </Text>
      </View>
    );
  }
  if (platform === "android") {
    return (
      <Text variant="muted" size="sm">
        When you tap Start, Android asks to pin GradeBook. Tap Got it / Pin to
        lock the phone to this app.
      </Text>
    );
  }
  return null;
}

/** The rules a lockdown quiz shows before an attempt starts. */
export function LockdownStartCard({
  details,
  startLabel,
  busy,
  platform,
  pinned,
  pinFailed,
  onStart,
  onStartWithoutPinning,
}: {
  details: string;
  startLabel: string;
  busy: boolean;
  /** Null when this build cannot pin (web, or an old native build). */
  platform: PinningPlatform;
  pinned: boolean;
  /** A pin attempt did not pin; offers the reported fallback. */
  pinFailed: boolean;
  onStart: () => void;
  onStartWithoutPinning: () => void;
}) {
  const { colors } = useTheme();
  const canPin = platform !== null;
  // iOS: the student turns Guided Access on first; the button tries it
  // automatically (works on managed devices) until it is on.
  const iosNeedsPin = platform === "ios" && !pinned;
  const showFallback = !canPin || pinFailed;

  return (
    <Card>
      <CardContent style={{ gap: 8 }}>
        <View style={styles.row}>
          <ShieldCheck color={colors.primary} size={20} />
          <Text weight="500" style={{ flex: 1 }}>
            This quiz is locked down
          </Text>
        </View>
        <Text variant="muted" size="sm">
          {canPin
            ? "GradeBook is pinned to the screen for the quiz, so you cannot switch apps until you submit."
            : "This device cannot pin the app. Stay in GradeBook until you submit."}
        </Text>
        <Text variant="muted" size="sm">
          {"•"} Screenshots and screen recordings of the quiz are blocked
          where your phone allows it, and taking one is reported.{"\n"}
          {"•"} Leaving the app, unpinning it or recording the screen is
          reported to your teacher, with how many times.{"\n"}
          {"•"} The screen stays on during the quiz.
        </Text>
        <Text variant="muted" size="sm">
          {details}
        </Text>
        {canPin ? (
          pinned ? (
            <View style={styles.row}>
              <Pin color={colors.primary} size={16} />
              <Text size="sm" weight="500" style={{ flex: 1 }}>
                {platform === "ios" ? "Guided Access is on." : "App is pinned."}
              </Text>
            </View>
          ) : (
            <PinningSteps platform={platform} />
          )
        ) : null}
        {pinFailed && !pinned ? (
          <Text size="sm" style={{ color: colors.destructive }}>
            {platform === "ios"
              ? "Guided Access is not on yet. Use the triple-click above, then come back here."
              : "The app was not pinned. Tap Start again and confirm the pin prompt."}
          </Text>
        ) : null}
        {canPin ? (
          <Button onPress={onStart} loading={busy}>
            {iosNeedsPin ? "Turn on Guided Access" : startLabel}
          </Button>
        ) : null}
        {showFallback ? (
          <View style={{ gap: 4 }}>
            <Button
              variant="outline"
              onPress={onStartWithoutPinning}
              disabled={busy}
            >
              Start without pinning
            </Button>
            <Text variant="muted" size="xs">
              {canPin
                ? "Only if pinning does not work on this device. Your teacher sees that the app was not pinned for the whole attempt."
                : "Your teacher sees that the app was not pinned for the whole attempt."}
            </Text>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}

const OVERLAY_COPY: Record<
  "left" | "unpinned" | "recording",
  { title: string; body: string }
> = {
  left: {
    title: "Return to your quiz",
    body: "You left the app. Your teacher has been notified. Your answers are saved",
  },
  unpinned: {
    title: "Pin the app to continue",
    body: "GradeBook is no longer pinned. Your teacher has been notified. Your answers are saved",
  },
  recording: {
    title: "Stop recording to continue",
    body: "Your screen is being recorded or mirrored. Your teacher has been notified. Stop the recording to carry on. Your answers are saved",
  },
};

/**
 * Covers the quiz while the attempt reads as away: after the student left the
 * app (until they tap back in), while it is unpinned (until pinned again) and
 * while the screen is recorded (until it stops).
 */
export function LockdownOverlay({
  visible,
  reason,
  platform,
  timeLeft,
  pinBusy,
  pinFailed,
  onReturn,
  onPin,
  onContinueWithoutPinning,
}: {
  visible: boolean;
  reason: QuizAwayReason | null;
  platform: PinningPlatform;
  timeLeft?: string | null;
  pinBusy: boolean;
  pinFailed: boolean;
  onReturn: () => void;
  onPin: () => void;
  onContinueWithoutPinning: () => void;
}) {
  const { colors, clay } = useTheme();
  const mode =
    reason === "screen_recording"
      ? "recording"
      : reason === "unpinned"
        ? "unpinned"
        : "left";
  const copy = OVERLAY_COPY[mode];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={mode === "left" ? onReturn : undefined}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: clay.radius.xl,
            },
          ]}
          accessibilityRole="alert"
        >
          <ShieldAlert color={colors.destructive} size={36} />
          <Text variant="subtitle" style={{ textAlign: "center" }}>
            {copy.title}
          </Text>
          <Text variant="muted" style={{ textAlign: "center" }}>
            {copy.body}
            {timeLeft ? " and the timer is still running" : ""}.
          </Text>
          {timeLeft ? (
            <Text weight="600" style={styles.timer}>
              {timeLeft}
            </Text>
          ) : null}
          {mode === "left" ? (
            <Button onPress={onReturn}>Return to quiz</Button>
          ) : null}
          {mode === "unpinned" ? (
            <View style={{ gap: 8, alignSelf: "stretch" }}>
              {platform === "ios" ? (
                <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
                  Triple-click the side button and tap Start to turn Guided
                  Access back on.
                </Text>
              ) : null}
              <Button onPress={onPin} loading={pinBusy}>
                {platform === "ios" ? "Turn on Guided Access" : "Pin the app"}
              </Button>
              {pinFailed ? (
                <Button variant="outline" onPress={onContinueWithoutPinning}>
                  Continue without pinning
                </Button>
              ) : null}
              {pinFailed ? (
                <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                  Your teacher sees that the app was not pinned.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * After the attempt: the app could not unpin itself (iOS Guided Access the
 * student started, or a pin Android did not release), so say how to end it.
 */
export function UnpinCard({ platform }: { platform: PinningPlatform }) {
  return (
    <Card>
      <CardContent style={{ gap: 4 }}>
        <Text weight="500">
          {platform === "ios" ? "End Guided Access" : "Unpin the app"}
        </Text>
        <Text variant="muted" size="sm">
          {platform === "ios"
            ? "Your quiz is finished. Triple-click the side button, enter your Guided Access passcode and tap End."
            : "Your quiz is finished. Touch and hold Back and Overview (or swipe up and hold) to unpin GradeBook."}
        </Text>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
  },
  timer: {
    fontFamily: "monospace",
    fontSize: 24,
    fontVariant: ["tabular-nums"],
  },
});
