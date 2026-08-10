import { Image, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

export function Avatar({
  uri,
  fallback,
  size = 40,
}: {
  uri?: string | null;
  fallback: string;
  size?: number;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.muted,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: size * 0.35,
            fontWeight: "600",
          }}
        >
          {fallback}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
