import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, FileText } from "lucide-react-native";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Skeleton } from "@/components/ui/Skeleton";
import { Markdown } from "@/components/ui/Markdown";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { userMessage } from "@/lib/errors";
import { downloadAndOpen } from "@/lib/open-file";
import { dueLabel } from "@/lib/work";
import { formatScore } from "@/lib/format-number";
import {
  fetchReview,
  marksComplete,
  reviewFilePath,
  saveReview,
  windowLabel,
  withMark,
  type ReviewMark,
  type ReviewToWrite,
} from "@/lib/peer-review";

/**
 * Write (or read back) one peer review: the classmate's work, then the
 * review form. Files open through the reviewer-only route.
 */
export default function PeerReviewScreen() {
  const { allocationId } = useLocalSearchParams<{ allocationId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const [data, setData] = useState<ReviewToWrite | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState("");
  const [marks, setMarks] = useState<ReviewMark[]>([]);

  const load = useCallback(async () => {
    if (!allocationId) return;
    try {
      const res = await fetchReview(allocationId);
      setData(res);
      setComment(res.review.comment ?? "");
      setMarks(res.review.marks);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [allocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(submit: boolean) {
    if (!data) return;
    if (submit && !marksComplete(data.rubric, marks)) {
      toast.error("Mark every criterion before handing in");
      return;
    }
    setSaving(true);
    try {
      const res = await saveReview(data.id, { comment: comment.trim() || null, marks, submit });
      setData({ ...data, review: res });
      toast.success(res.submittedAt ? "Review handed in" : "Draft saved");
    } catch (err) {
      toast.error(userMessage(err, "Could not save your review"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen title="Peer review" onBack={() => router.back()}>
        <Skeleton style={{ height: 200 }} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen title="Peer review" onBack={() => router.back()}>
        <Text variant="muted">This review is not available.</Text>
      </Screen>
    );
  }

  const editable = data.canEdit && !saving;
  return (
    <Screen
      title={`Peer review ${data.number}`}
      description={`${data.activityTitle} · ${windowLabel({ state: data.state, opensAt: null, closesAt: data.closesAt }, dueLabel)}`}
      onBack={() => router.back()}
    >
      <View style={{ gap: 12 }}>
        <Card>
          <CardHeader>
            <CardTitle>{data.author ? `${data.author}'s work` : "A classmate's work"}</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 10 }}>
            {data.submission.textBody ? (
              <Text size="sm" selectable>
                {data.submission.textBody}
              </Text>
            ) : (
              <Text size="sm" variant="muted">
                No text was handed in.
              </Text>
            )}
            {data.submission.files.map((f) => (
              <Button
                key={f.id}
                variant="outline"
                size="sm"
                accessibilityLabel={`Open ${f.name}`}
                onPress={() =>
                  void downloadAndOpen(reviewFilePath(data.id, f.id), f.name).catch((err) =>
                    toast.error(userMessage(err, "Could not open the file")),
                  )
                }
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <FileText size={16} color={colors.foreground} />
                  <Text size="sm">{f.name}</Text>
                </View>
              </Button>
            ))}
            {data.instructions ? (
              <View style={{ gap: 4 }}>
                <Text weight="600" size="sm">
                  Assignment instructions
                </Text>
                <Markdown>{data.instructions}</Markdown>
              </View>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <CardTitle>Your review</CardTitle>
              <Badge variant={data.review.submittedAt ? "secondary" : "outline"}>
                {data.review.submittedAt ? "Handed in" : "Draft"}
              </Badge>
            </View>
          </CardHeader>
          <CardContent style={{ gap: 14 }}>
            {data.rubric?.criteria.map((c) => {
              const mark = marks.find((m) => m.criterionId === c.id);
              return (
                <View key={c.id} style={{ gap: 6 }}>
                  <Text weight="600">
                    {c.title} ({formatScore(c.points)} pts)
                  </Text>
                  {c.description ? (
                    <Text size="xs" variant="muted">
                      {c.description}
                    </Text>
                  ) : null}
                  {c.ratings.length > 0 ? (
                    <View accessibilityRole="radiogroup" accessibilityLabel={c.title} style={{ gap: 6 }}>
                      {c.ratings.map((r) => {
                        const chosen = mark?.ratingId === r.id;
                        return (
                          <Pressable
                            key={r.id}
                            disabled={!editable}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: chosen, disabled: !editable }}
                            accessibilityLabel={`${c.title}: ${r.label}, ${formatScore(r.points)} points`}
                            onPress={() =>
                              setMarks(
                                withMark(marks, {
                                  criterionId: c.id,
                                  ratingId: r.id,
                                  points: r.points,
                                  comment: mark?.comment ?? null,
                                }),
                              )
                            }
                            style={[
                              styles.rating,
                              {
                                borderColor: chosen ? colors.primary : colors.border,
                                backgroundColor: chosen ? colors.muted : "transparent",
                              },
                            ]}
                          >
                            <Text size="sm" weight={chosen ? "600" : "500"} style={{ flex: 1 }}>
                              {r.label}
                            </Text>
                            <Text size="xs" variant="muted">
                              {formatScore(r.points)} pts
                            </Text>
                            {chosen ? <Check size={16} color={colors.primary} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Input
                      keyboardType="decimal-pad"
                      accessibilityLabel={`Points for ${c.title}`}
                      editable={editable}
                      value={mark ? String(mark.points) : ""}
                      onChangeText={(t) =>
                        setMarks(
                          withMark(marks, {
                            criterionId: c.id,
                            ratingId: null,
                            points: Number(t.replace(",", ".")) || 0,
                            comment: mark?.comment ?? null,
                          }),
                        )
                      }
                    />
                  )}
                </View>
              );
            })}
            <View style={{ gap: 6 }}>
              <Text weight="600">{data.rubric ? "Overall comment (optional)" : "Your review"}</Text>
              <TextArea
                accessibilityLabel={data.rubric ? "Overall comment" : "Your review"}
                editable={editable}
                value={comment}
                onChangeText={setComment}
                placeholder="What works well, and what would make it better?"
              />
            </View>
            {data.canEdit ? (
              <View style={{ gap: 8 }}>
                {!data.review.submittedAt ? (
                  <Button variant="outline" disabled={saving} onPress={() => void save(false)}>
                    Save draft
                  </Button>
                ) : null}
                <Button disabled={saving} loading={saving} onPress={() => void save(true)}>
                  {data.review.submittedAt ? "Save changes" : "Hand in review"}
                </Button>
              </View>
            ) : (
              <Text size="sm" variant="muted">
                Peer review has closed; this review can no longer change.
              </Text>
            )}
            <Text size="xs" variant="muted">
              {data.anonymous
                ? "Your name is not shown to the author. Your teacher can see every review."
                : "The author will see your name. Your teacher can see every review."}
            </Text>
          </CardContent>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
