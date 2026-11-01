import { Image, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The school's logo beside its name, at the top of the home screens. Shows
 * nothing when the school has no logo (admins set it on the web app).
 */
export function SchoolLogo({
  logoUrl,
  name,
}: {
  logoUrl: string | null | undefined;
  name: string | null | undefined;
}) {
  const { colors } = useTheme();
  if (!logoUrl) return null;
  return (
    <View style={styles.row}>
      <Image
        source={{ uri: logoUrl }}
        style={[styles.logo, { borderColor: colors.border }]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      {name ? (
        <Text weight="600" numberOfLines={1} style={{ flex: 1 }}>
          {name}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
