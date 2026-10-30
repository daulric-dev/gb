import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { LogOut, Monitor, Smartphone } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/course";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";

/** One row of GET /auth/sessions. */
export interface SignedInSession {
  id: string;
  current: boolean;
  method: string;
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

const isPhone = (device: string) =>
  /app on|iPhone|iPad|Android|iOS/i.test(device);

/**
 * Signed-in devices: every live session of this account, this one marked,
 * a sign-out button on every other device, plus "Sign out of all other devices". Shared
 * by the staff and student settings screens.
 */
export function SignedInDevices({ refreshKey = 0 }: { refreshKey?: number }) {
  const router = useRouter();
  const toast = useToast();
  const { logout } = useAuth();
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<SignedInSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await api<SignedInSession[]>("/auth/sessions"));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function signOut(session: SignedInSession) {
    if (session.current) {
      await logout();
      toast.success("Logged out");
      router.replace("/(auth)/login");
      return;
    }
    setBusy(session.id);
    try {
      await api(`/auth/sessions/${session.id}`, { method: "DELETE" });
      toast.success(`Signed out ${session.device}`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to sign out");
    } finally {
      setBusy(null);
    }
  }

  async function signOutOthers() {
    setBusy("others");
    try {
      const { revoked } = await api<{ revoked: number }>(
        "/auth/sessions/revoke-others",
        { method: "POST" },
      );
      toast.success(
        revoked === 1 ? "Signed out 1 device" : `Signed out ${revoked} devices`,
      );
      setConfirmOthers(false);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to sign out");
    } finally {
      setBusy(null);
    }
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed-in devices</CardTitle>
        <CardDescription>
          Where your account is signed in. Sign out any device you don't
          recognise. Each sign-in lasts at most 90 days.
        </CardDescription>
      </CardHeader>
      <CardContent style={{ gap: 12 }}>
        {sessions === null ? (
          <>
            <Skeleton style={{ height: 44 }} />
            <Skeleton style={{ height: 44 }} />
          </>
        ) : sessions.length === 0 ? (
          <Text variant="muted">No devices to show.</Text>
        ) : (
          sessions.map((s) => {
            const Icon = isPhone(s.device) ? Smartphone : Monitor;
            return (
              <View key={s.id} style={styles.row}>
                <Icon size={18} color={colors.mutedForeground} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.title}>
                    <Text weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {s.device}
                    </Text>
                    {s.current ? <Badge variant="default">This device</Badge> : null}
                  </View>
                  <Text variant="muted" style={{ fontSize: 12 }} numberOfLines={1}>
                    {s.current ? "Active now" : `Last active ${timeAgo(s.lastSeenAt)}`}
                    {s.ip ? ` · ${s.ip}` : ""}
                  </Text>
                </View>
                {/* This device signs out from Settings, not here. */}
                {s.current ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busy === s.id}
                    disabled={busy !== null}
                    onPress={() => void signOut(s)}
                    accessibilityLabel={`Sign out ${s.device}`}
                  >
                    Sign out
                  </Button>
                )}
              </View>
            );
          })
        )}
        {others > 0 ? (
          <Button
            variant="outline"
            onPress={() => setConfirmOthers(true)}
            disabled={busy !== null}
            icon={<LogOut size={16} color={colors.foreground} />}
          >
            Sign out of all other devices
          </Button>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmOthers}
        title="Sign out other devices?"
        message="Every device except this one will need to sign in again."
        confirmLabel="Sign out"
        destructive
        loading={busy === "others"}
        onConfirm={() => void signOutOthers()}
        onCancel={() => setConfirmOthers(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flexDirection: "row", alignItems: "center", gap: 8 },
});
