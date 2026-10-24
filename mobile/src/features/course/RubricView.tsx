import { Pressable, StyleSheet, View } from "react-native";
import { Check } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/theme/ThemeProvider";
import { formatScore } from "@/lib/format-number";
import type { Rubric, RubricAssessment } from "@/lib/course";

/**
 * A rubric as a stack of criteria, each with its levels. Read-only by
 * default, showing the level picked for each criterion once marked; pass
 * `onSelect` to make the levels tappable for marking.
 */
export function RubricView({
  rubric,
  assessments,
  onSelect,
}: {
  rubric: Rubric;
  assessments?: RubricAssessment[] | null;
  onSelect?: (criterionId: string, ratingId: string, points: number) => void;
}) {
  const { colors } = useTheme();
  const byCriterion = new Map(
    (assessments ?? []).map((a) => [a.criterionId, a] as const),
  );
  const total = assessments?.length
    ? assessments.reduce((sum, a) => sum + (a.points ?? 0), 0)
    : null;

  return (
    <View style={{ gap: 14 }}>
      {rubric.criteria.map((c) => {
        const mark = byCriterion.get(c.id);
        return (
          <View key={c.id} style={{ gap: 8 }}>
            <View style={styles.head}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="600">{c.title}</Text>
                {c.description ? (
                  <Text variant="muted" size="xs">
                    {c.description}
                  </Text>
                ) : null}
              </View>
              <Text weight="600" size="sm">
                {mark ? `${formatScore(mark.points)}/` : ""}
                {formatScore(c.points)} pts
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              {c.ratings.map((r) => {
                const chosen = mark?.ratingId === r.id;
                return (
                  <Pressable
                    key={r.id}
                    disabled={!onSelect}
                    onPress={() => onSelect?.(c.id, r.id, r.points)}
                    style={({ pressed }) => [
                      styles.rating,
                      {
                        borderColor: chosen ? colors.primary : colors.border,
                        backgroundColor: chosen ? colors.muted : "transparent",
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text size="sm" weight={chosen ? "600" : "500"}>
                        {r.label}
                      </Text>
                      {r.description ? (
                        <Text variant="muted" size="xs">
                          {r.description}
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="muted" size="xs">
                      {formatScore(r.points)} pts
                    </Text>
                    {chosen ? <Check color={colors.primary} size={16} /> : null}
                  </Pressable>
                );
              })}
            </View>
            {mark?.comment ? (
              <Text variant="muted" size="xs" style={{ fontStyle: "italic" }}>
                {mark.comment}
              </Text>
            ) : null}
          </View>
        );
      })}
      <View style={[styles.total, { borderTopColor: colors.border }]}>
        <Text weight="600">Total</Text>
        <Text weight="600">
          {total !== null ? `${formatScore(total)}/` : ""}
          {formatScore(rubric.pointsPossible)} pts
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
});
