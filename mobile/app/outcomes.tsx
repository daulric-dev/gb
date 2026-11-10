import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Target } from "lucide-react-native";
import { api } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";
import { MY_OUTCOMES_PATH, type MyOutcomes } from "@/lib/mastery";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { OutcomeList } from "@/components/mastery/OutcomeList";

/** The student's mastery of each course's learning outcomes, with the evidence. */
export default function OutcomesScreen() {
  const router = useRouter();
  const [data, setData] = useState<MyOutcomes | null>(null);
  const [off, setOff] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<MyOutcomes>(MY_OUTCOMES_PATH)
        .then((d) => {
          setData(d);
          setOff(false);
          setFailed(false);
        })
        .catch((err) => {
          if (isFeatureDisabledError(err)) setOff(true);
          else setFailed(true);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  return (
    <Screen
      title="Outcomes"
      description="Your progress on each learning outcome"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {off ? (
        <EmptyState icon={Target} title="Outcomes are turned off" description="Your school has not switched mastery tracking on." />
      ) : failed ? (
        <EmptyState icon={Target} title="Could not load your outcomes" description="Pull down to try again." />
      ) : data === null ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 100 }} />
          <Skeleton style={{ height: 100 }} />
        </View>
      ) : data.courses.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No outcomes yet"
          description="When your teachers link outcomes to your work, your progress shows here."
        />
      ) : (
        <View style={{ gap: 12 }}>
          <Text variant="muted" size="xs">
            Alongside your grades; it does not change them. Late penalties never count.
          </Text>
          {data.courses.map((c) => (
            <Card key={c.courseId}>
              <CardHeader>
                <CardTitle>{c.courseCode ? `${c.courseName} (${c.courseCode})` : c.courseName}</CardTitle>
              </CardHeader>
              <CardContent>
                <OutcomeList outcomes={c.outcomes} scale={data.scale} />
              </CardContent>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
