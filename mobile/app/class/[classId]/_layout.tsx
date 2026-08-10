import { Stack, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";
import { ClassProvider } from "@/features/class/ClassContext";

export default function ClassDetailLayout() {
  const { colors } = useTheme();
  const { classId } = useLocalSearchParams<{ classId: string }>();

  return (
    <ClassProvider classId={classId}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="grading" />
        <Stack.Screen name="attendance" />
      </Stack>
    </ClassProvider>
  );
}
