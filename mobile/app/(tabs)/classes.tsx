import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { BookOpen, ChevronRight } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import type { AcademicYear, ClassItem } from "@/lib/types";
import { Screen } from "@/components/layout/Screen";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";

function ClassCard({
  item,
  yearName,
}: {
  item: ClassItem;
  yearName?: string;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/class/${item.id}` as Href)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card>
        <CardHeader style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <CardTitle>{item.name ?? "Untitled class"}</CardTitle>
            {yearName ? (
              <Text variant="muted" style={{ marginTop: 2 }}>
                {yearName}
              </Text>
            ) : null}
          </View>
          {item.isClassTeacher ? (
            <Badge variant="secondary">Class Teacher</Badge>
          ) : null}
          <ChevronRight size={20} color={colors.mutedForeground} />
        </CardHeader>
      </Card>
    </Pressable>
  );
}

function Section({
  title,
  data,
  yearMap,
}: {
  title: string;
  data: ClassItem[];
  yearMap: Map<string, string>;
}) {
  if (data.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text variant="subtitle">{title}</Text>
      {data.map((c) => (
        <ClassCard
          key={c.id}
          item={c}
          yearName={c.academicYearId ? yearMap.get(c.academicYearId) : undefined}
        />
      ))}
    </View>
  );
}

export default function ClassesScreen() {
  const { colors } = useTheme();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [yearMap, setYearMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    const [cls, years] = await Promise.all([
      api<ClassItem[]>("/classes").catch(() => [] as ClassItem[]),
      api<AcademicYear[]>("/academic-years").catch(() => [] as AcademicYear[]),
    ]);
    setClasses(cls);
    setYearMap(new Map(years.map((y) => [y.id, y.name])));
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData().finally(() => setRefreshing(false));
  }, [fetchData]);

  const myClasses = classes.filter((c) => c.isClassTeacher);
  const subjectClasses = classes.filter((c) => !c.isClassTeacher);

  return (
    <Screen
      title="Classes"
      description="View your assigned classes"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 84, borderRadius: 14 }} />
          ))}
        </View>
      ) : classes.length === 0 ? (
        <Card>
          <CardContent style={styles.empty}>
            <BookOpen size={40} color={colors.mutedForeground} />
            <Text weight="600" style={{ marginTop: 12 }}>
              No classes yet
            </Text>
            <Text variant="muted" style={{ textAlign: "center", marginTop: 4 }}>
              Classes assigned to you will appear here.
            </Text>
          </CardContent>
        </Card>
      ) : (
        <View style={{ gap: 24 }}>
          <Section title="My Classes" data={myClasses} yearMap={yearMap} />
          <Section
            title="Subject Classes"
            data={subjectClasses}
            yearMap={yearMap}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 20,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
});
