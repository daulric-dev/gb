import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeftRight, Check } from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { userMessage } from "@/lib/errors";

/** One row of GET /me/schools. */
interface MySchool {
  id: string;
  name: string | null;
  logoUrl: string | null;
  role: string | null;
  /** Reachable only as an organisation admin. */
  viaOrganisation: boolean;
  isActive: boolean;
}

/**
 * "Switch school" for staff who can work in more than one school (several
 * memberships, or an organisation admin). Renders nothing otherwise.
 */
export function SwitchSchool({ refreshKey = 0 }: { refreshKey?: number }) {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { profile, refresh } = useAuth();
  const permissions = usePermissions();
  const [schools, setSchools] = useState<MySchool[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const activeId = profile?.school?.id ?? null;
  const isStaff = profile?.account_type !== "student";

  const load = useCallback(async () => {
    try {
      const list = await api<MySchool[]>("/me/schools");
      setSchools(Array.isArray(list) ? list : []);
    } catch {
      setSchools([]);
    }
  }, []);

  useEffect(() => {
    if (isStaff) void load();
  }, [load, isStaff, activeId, refreshKey]);

  async function switchTo(school: MySchool) {
    if (school.isActive) {
      setOpen(false);
      return;
    }
    setBusy(school.id);
    try {
      await api("/me/active-school", {
        method: "PUT",
        body: { schoolId: school.id },
      });
      await Promise.all([refresh(), permissions.refresh()]);
      setOpen(false);
      toast.success(`Switched to ${school.name ?? "school"}`);
      router.replace("/(tabs)");
    } catch (err) {
      toast.error(userMessage(err, "Could not switch school"));
    } finally {
      setBusy(null);
    }
  }

  if (!isStaff || schools.length < 2) return null;

  return (
    <>
      <Card>
        <CardContent style={styles.row}>
          <ArrowLeftRight size={18} color={colors.mutedForeground} />
          <Text style={{ flex: 1 }}>Switch school</Text>
          <Button variant="outline" size="sm" onPress={() => setOpen(true)}>
            Choose
          </Button>
        </CardContent>
      </Card>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Switch school"
        description="Pick the school to work in."
      >
        <View style={{ gap: 8 }}>
          {schools.map((s) => (
            <Pressable
              key={s.id}
              disabled={!!busy}
              onPress={() => void switchTo(s)}
              style={[styles.option, { borderColor: colors.border }]}
            >
              <Text style={{ flex: 1 }} numberOfLines={1}>
                {s.name ?? "Unnamed school"}
              </Text>
              {s.viaOrganisation ? (
                <Badge variant="outline">via organisation</Badge>
              ) : null}
              {s.isActive ? <Check size={16} color={colors.primary} /> : null}
              {busy === s.id ? <Text variant="muted">…</Text> : null}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
});
