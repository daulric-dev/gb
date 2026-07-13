import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

export default function ChatLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[conversationId]" />
    </Stack>
  );
}
