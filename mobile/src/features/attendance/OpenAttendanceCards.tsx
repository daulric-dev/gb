import { useCallback, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { CheckCircle2, ChevronRight, Hand } from "lucide-react-native";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/theme/ThemeProvider";
import {
  formatCountdown,
  STATUS_LABEL,
  useRemaining,
  type PortalOpenAttendance,
} from "@/lib/attendance";

const POLL_MS = 20_000;

/**
 * "Attendance open" banners for the student home. Polls while the screen is
 * focused and refreshes whenever the app comes back to the foreground, so a
 * student who dismissed the push still finds the check-in here.
 */
export function OpenAttendanceCards({ refreshKey = 0 }: { refreshKey?: number }) {
  const [open, setOpen] = useState<PortalOpenAttendance[]>([]);

  const load = useCallback(async () => {
    const data = await api<PortalOpenAttendance[]>(
      "/portal/me/attendance/open",
    ).catch(() => null);
    if (data) setOpen(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), POLL_MS);
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") void load();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [load, refreshKey]),
  );

  if (open.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      {open.map((s) =>
        s.myStatus ? (
          <CheckedInRow key={s.sessionId} session={s} />
        ) : (
          <OpenCard key={s.sessionId} session={s} />
        ),
      )}
    </View>
  );
}

function OpenCard({ session }: { session: PortalOpenAttendance }) {
  const router = useRouter();
  const { colors } = useTheme();
  const remaining = useRemaining(session.closesAt);
  if (remaining <= 0) return null;

  return (
    <Pressable
      onPress={() => router.push(`/attendance/${session.sessionId}` as Href)}
    >
      {({ pressed }) => (
        <Card
          style={{
            backgroundColor: colors.primary,
            opacity: pressed ? 0.85 : 1,
          }}
        >
          <CardContent style={styles.row}>
            <Hand color={colors.primaryForeground} size={22} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="600" style={{ color: colors.primaryForeground }}>
                Attendance open
              </Text>
              <Text
                size="sm"
                numberOfLines={1}
                style={{ color: colors.primaryForeground, opacity: 0.8 }}
              >
                {session.courseName} · closes in {formatCountdown(remaining)}
              </Text>
            </View>
            <ChevronRight color={colors.primaryForeground} size={20} />
          </CardContent>
        </Card>
      )}
    </Pressable>
  );
}

function CheckedInRow({ session }: { session: PortalOpenAttendance }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, styles.small]}>
      <CheckCircle2 color={colors.mutedForeground} size={16} />
      <Text variant="muted" size="sm" numberOfLines={1} style={{ flex: 1 }}>
        Checked in to {session.courseName}
        {session.myStatus ? ` · ${STATUS_LABEL[session.myStatus]}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  small: { paddingHorizontal: 4, gap: 8 },
});
