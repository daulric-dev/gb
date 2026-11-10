import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useFeatures } from "@/lib/use-features";
import { dueLabel } from "@/lib/work";
import { formatScore } from "@/lib/format-number";
import {
  fetchActivityPeerReview,
  windowLabel,
  type ReceivedReview,
  type StudentPeerReview,
} from "@/lib/peer-review";
import type { Rubric } from "@/lib/course";

function Received({ review, rubric }: { review: ReceivedReview; rubric: Rubric | null }) {
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`Review ${review.number}${review.reviewer ? ` by ${review.reviewer}` : ""}`}>
      <Text weight="600" size="sm">
        Review {review.number}
        {review.reviewer ? ` by ${review.reviewer}` : ""}
      </Text>
      {rubric
        ? rubric.criteria.map((c) => {
            const m = review.marks.find((x) => x.criterionId === c.id);
            const level = m?.ratingId ? c.ratings.find((r) => r.id === m.ratingId) : null;
            return (
              <Text key={c.id} size="sm" variant="muted">
                {c.title}: {m ? `${level ? `${level.label} · ` : ""}${formatScore(m.points)}/${formatScore(c.points)}` : "Not marked"}
                {m?.comment ? ` — ${m.comment}` : ""}
              </Text>
            );
          })
        : null}
      {review.comment ? <Text size="sm">{review.comment}</Text> : null}
    </View>
  );
}

/** The student's peer review on an assignment: reviews to write and reviews received. */
export function PeerReviewSection({ activityId }: { activityId: string }) {
  const router = useRouter();
  const { hasFeature } = useFeatures();
  const on = hasFeature("peer_review");
  const [data, setData] = useState<StudentPeerReview | null>(null);

  useEffect(() => {
    if (!on) return;
    fetchActivityPeerReview(activityId)
      .then(setData)
      .catch(() => setData(null));
  }, [on, activityId]);

  if (!on || !data || !data.enabled) return null;
  if (data.assigned.length === 0 && data.received === null && data.state === "open") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Peer review</CardTitle>
        <Text size="xs" variant="muted">
          {windowLabel(data, dueLabel)}
          {data.anonymous ? " · Anonymous" : ""}
        </Text>
      </CardHeader>
      <CardContent style={{ gap: 12 }}>
        {data.assigned.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text weight="600" accessibilityRole="header">
              Reviews for you to write
            </Text>
            {data.assigned.map((a) => (
              <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text size="sm" style={{ flex: 1 }}>
                  Review {a.number}
                  {a.author ? `: ${a.author}` : ""}
                </Text>
                <Badge variant={a.submittedAt ? "secondary" : "outline"}>
                  {a.submittedAt ? "Handed in" : "To do"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  accessibilityLabel={`Open review ${a.number}`}
                  onPress={() => router.push(`/peer-review/${a.id}` as Href)}
                >
                  {data.state === "open" ? (a.submittedAt ? "Edit" : "Write") : "View"}
                </Button>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ gap: 8 }}>
          <Text weight="600" accessibilityRole="header">
            Reviews of your work
          </Text>
          {data.received === null ? (
            <Text size="sm" variant="muted">
              You can read them here when peer review closes.
            </Text>
          ) : data.received.length === 0 ? (
            <Text size="sm" variant="muted">
              No reviews were handed in for your work.
            </Text>
          ) : (
            data.received.map((r) => <Received key={r.id} review={r} rubric={data.rubric} />)
          )}
        </View>
      </CardContent>
    </Card>
  );
}
