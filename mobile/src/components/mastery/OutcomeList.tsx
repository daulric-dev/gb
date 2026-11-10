import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import {
  SOURCE_LABEL,
  STATUS_LABEL,
  formatEvidenceDate,
  levelTone,
  outcomeAccessibilityLabel,
  toneColor,
  type MasteryScale,
  type OutcomeProgress,
} from "@/lib/mastery";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";

/** A level as an outline badge in its tone, always with its label. */
export function LevelBadge({ level, label, scale }: { level: number | null; label: string | null; scale: MasteryScale }) {
  const { scheme } = useTheme();
  return (
    <Badge variant="outline" color={toneColor(levelTone(level, scale), scheme)}>
      {label ?? "No evidence"}
    </Badge>
  );
}

function OutcomeRow({ outcome, scale }: { outcome: OutcomeProgress; scale: MasteryScale }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const hasEvidence = outcome.evidence.length > 0;
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={outcomeAccessibilityLabel(outcome)}
        accessibilityHint={hasEvidence ? (open ? "Hides the evidence" : "Shows the evidence") : undefined}
        accessibilityState={{ expanded: open, disabled: !hasEvidence }}
        disabled={!hasEvidence}
        onPress={() => setOpen((v) => !v)}
        style={styles.header}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontWeight: "600" }}>
            {outcome.code} {outcome.title}
          </Text>
          <Text variant="muted" size="xs">
            {STATUS_LABEL[outcome.mastery.status]}
            {hasEvidence ? ` · ${outcome.evidence.length} evidence` : ""}
          </Text>
        </View>
        <LevelBadge level={outcome.mastery.level} label={outcome.mastery.label} scale={scale} />
        {hasEvidence && <Chevron color={colors.mutedForeground} size={18} />}
      </Pressable>
      {open && (
        <View style={[styles.timeline, { borderColor: colors.border }]}>
          {outcome.evidence.map((e) => (
            <View
              key={e.id}
              style={styles.evidence}
              accessible
              accessibilityLabel={`${e.activityTitle}, ${formatEvidenceDate(e.assessedAt)}, ${e.label ?? ""}, ${e.percent} percent`}
            >
              <View style={{ flex: 1 }}>
                <Text size="sm">{e.activityTitle}</Text>
                <Text variant="muted" size="xs">
                  {formatEvidenceDate(e.assessedAt)} · {SOURCE_LABEL[e.source]}
                  {e.detail ? `: ${e.detail}` : ""} · {e.percent}%
                </Text>
              </View>
              <LevelBadge level={e.level} label={e.label} scale={scale} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Outcomes with mastery and an expandable evidence timeline (newest first). */
export function OutcomeList({ outcomes, scale }: { outcomes: OutcomeProgress[]; scale: MasteryScale }) {
  if (outcomes.length === 0) return <Text variant="muted">No outcomes are tracked here yet.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {outcomes.map((o) => (
        <OutcomeRow key={o.id} outcome={o} scale={scale} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  timeline: { borderLeftWidth: 2, paddingLeft: 10, gap: 8 },
  evidence: { flexDirection: "row", alignItems: "center", gap: 8 },
});
