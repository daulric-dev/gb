import { Pressable, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ClipboardList, CalendarCheck, ChevronRight } from "lucide-react-native";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { useClass } from "@/features/class/ClassContext";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";

function NavRow({
  icon: Icon,
  title,
  subtitle,
  onPress,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card>
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
            <Icon size={22} color={colors.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text weight="600">{title}</Text>
            <Text variant="muted" style={{ marginTop: 2 }}>
              {subtitle}
            </Text>
          </View>
          <ChevronRight size={20} color={colors.mutedForeground} />
        </View>
      </Card>
    </Pressable>
  );
}

export default function ClassOverviewScreen() {
  const router = useRouter();
  const { classId, classInfo, loading } = useClass();

  const base = `/class/${classId}`;

  return (
    <Screen
      title={loading ? "Class" : (classInfo?.name ?? "Class")}
      description={classInfo?.isClassTeacher ? undefined : "Subject class"}
      onBack={() => router.back()}
      action={
        classInfo?.isClassTeacher ? (
          <Badge variant="secondary">Class Teacher</Badge>
        ) : undefined
      }
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          {[0, 1].map((i) => (
            <Skeleton key={i} style={{ height: 84, borderRadius: 14 }} />
          ))}
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <NavRow
            icon={ClipboardList}
            title="Grading"
            subtitle="Enter and manage assessment grades"
            onPress={() => router.push(`${base}/grading` as Href)}
          />
          <NavRow
            icon={CalendarCheck}
            title="Attendance"
            subtitle="Mark and review daily attendance"
            onPress={() => router.push(`${base}/attendance` as Href)}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
