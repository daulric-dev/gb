import { useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTheme } from "@/theme/ThemeProvider";
import { deadlineReason, type QueuedDraft } from "@/lib/sync-queue";

/**
 * A draft on this device that needs the student: the deadline passed while
 * offline, the server copy changed elsewhere (conflict), or the server
 * refused it. The draft is never sent silently; it can be viewed and shared
 * or copied (the share sheet has Copy), kept or deleted.
 */
export function OfflineDraftNotice({
  draft,
  kind,
  draftText,
  serverText,
  onKeepDevice,
  onUseServer,
  onDiscard,
}: {
  draft: QueuedDraft;
  kind: "quiz" | "assignment";
  /** The draft as text. */
  draftText: string;
  /** The server's copy as text (conflicts). */
  serverText?: string | null;
  onKeepDevice: () => void;
  onUseServer: () => void;
  onDiscard: () => void;
}) {
  const { colors } = useTheme();
  const [showDraft, setShowDraft] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // The deadline is checked here too: the queue may not have run yet.
  const late = deadlineReason(draft, Date.now());
  const reason =
    draft.state === "needs_attention" ? (draft.reason ?? late) : late;
  if (!reason) return null;

  const title =
    reason === "conflict"
      ? "Changed on another device"
      : reason === "rejected"
        ? "Your offline draft could not be saved"
        : "This was due while you were offline";

  const body =
    reason === "conflict"
      ? `Your ${kind === "quiz" ? "answers" : "work"} on the server changed after you started this draft on this device. Both copies are kept until you choose one.`
      : reason === "rejected"
        ? `${draft.message ? `${draft.message}. ` : ""}Your draft is saved on this device.`
        : kind === "quiz"
          ? reason === "expired"
            ? "Your draft is saved on this device. The quiz time ran out before it could be sent, so it was not submitted. Answers that reached the server in time were submitted."
            : "Your draft is saved on this device. The quiz closed before it could be sent, so it was not submitted."
          : "Your draft is saved on this device. It was not handed in. You can view or copy it, and ask your teacher for an extension.";

  async function share() {
    try {
      await Share.share({ message: draftText });
    } catch {
      /* dismissed */
    }
  }

  return (
    <Card>
      <CardContent style={{ gap: 10 }}>
        <View
          style={styles.title}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={`${title}. ${body}`}
        >
          <AlertTriangle color={colors.destructive} size={18} />
          <Text weight="600" style={{ flex: 1 }}>
            {title}
          </Text>
        </View>
        <Text variant="muted" size="sm">
          {body}
        </Text>

        {showDraft && (
          <View style={{ gap: 8 }}>
            <Text size="xs" weight="600">
              This device's draft
            </Text>
            <Text
              selectable
              size="sm"
              style={[styles.draft, { borderColor: colors.border, backgroundColor: colors.muted }]}
            >
              {draftText}
            </Text>
            {reason === "conflict" && serverText ? (
              <>
                <Text size="xs" weight="600">
                  On the server
                </Text>
                <Text
                  selectable
                  size="sm"
                  style={[styles.draft, { borderColor: colors.border }]}
                >
                  {serverText}
                </Text>
              </>
            ) : null}
          </View>
        )}

        <View style={styles.actions}>
          <Button
            variant="outline"
            size="sm"
            onPress={() => setShowDraft((v) => !v)}
            accessibilityState={{ expanded: showDraft }}
          >
            {showDraft
              ? "Hide draft"
              : reason === "conflict"
                ? "Compare copies"
                : "View draft"}
          </Button>
          <Button variant="outline" size="sm" onPress={() => void share()}>
            Share or copy
          </Button>
        </View>

        {reason === "conflict" ? (
          <View style={styles.actions}>
            <Button size="sm" onPress={onKeepDevice}>
              Keep this device's draft
            </Button>
            <Button variant="outline" size="sm" onPress={onUseServer}>
              Use the server copy
            </Button>
          </View>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setConfirmDiscard(true)}
          >
            Delete draft from this device
          </Button>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDiscard}
        title="Delete this draft?"
        message="It is only on this device. Share or copy it first if you want to keep it."
        confirmLabel="Delete draft"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onDiscard();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: "row", alignItems: "center", gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  draft: {
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
