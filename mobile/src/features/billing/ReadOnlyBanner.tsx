import { StyleSheet, View } from "react-native";
import { Lock } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/theme/ThemeProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useBillingStatus } from "@/lib/billing";

/**
 * Shown on the home screens when the school's subscription has lapsed and the
 * platform is read-only. Renders nothing while billing is off (self-hosted)
 * or the school is in good standing. Billing itself is managed on the web.
 */
export function ReadOnlyBanner({ isAdmin = false }: { isAdmin?: boolean }) {
  const { colors, radius } = useTheme();
  const { profile } = useAuth();
  const status = useBillingStatus(profile?.school?.id ?? null);

  if (!status.enabled || !status.readOnly) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          borderColor: colors.destructive,
          borderRadius: radius.lg,
          backgroundColor: `${colors.destructive}1a`,
        },
      ]}
    >
      <Lock size={20} color={colors.destructive} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontWeight: "600" }}>
          Your school&apos;s subscription has lapsed - the platform is read-only.
        </Text>
        <Text variant="muted">
          {isAdmin
            ? "You can still view everything. Renew from Settings > Billing in the GradeBook web app."
            : "You can still view everything. Ask your school administrator to renew."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
});
