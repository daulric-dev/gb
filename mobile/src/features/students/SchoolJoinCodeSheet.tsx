import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyRound, ShieldAlert } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

interface SchoolCodeStatus {
  activeCode: { expiresAt: string; issuedAt: string | null } | null;
  expired: boolean;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SchoolJoinCodeSheet({
  open,
  onClose,
  canIssue,
}: {
  open: boolean;
  onClose: () => void;
  canIssue: boolean;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [status, setStatus] = useState<SchoolCodeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<SchoolCodeStatus>("/schools/join-code");
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setIssuedCode(null);
    void load();
  }, [open, load]);

  const issue = async () => {
    setWorking(true);
    try {
      const result = await api<{ code: string; expiresAt: string }>(
        "/schools/join-code",
        { method: "POST", body: {} },
      );
      setIssuedCode(result.code);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to issue join code",
      );
    } finally {
      setWorking(false);
    }
  };

  const revoke = async () => {
    setWorking(true);
    try {
      await api("/schools/join-code", { method: "DELETE" });
      setIssuedCode(null);
      toast.success("Join code revoked");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke join code",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="School Join Code"
      description="Students enter this code when signing up to join your school roster."
    >
      <View style={{ gap: 16 }}>
        {issuedCode ? (
          <View style={{ gap: 10 }}>
            <Card style={{ borderColor: colors.primary }}>
              <CardContent style={styles.codeCard}>
                <Text style={styles.codeText}>{issuedCode}</Text>
              </CardContent>
            </Card>
            <Text variant="muted" style={{ fontSize: 13, textAlign: "center" }}>
              Write this down now. Only a hash is stored, so it cannot be shown
              again. If it is lost, issue a new one.
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={{ gap: 10 }}>
            <Skeleton style={{ height: 70, borderRadius: 12 }} />
          </View>
        ) : status?.activeCode ? (
          <Card>
            <CardContent style={styles.statusContent}>
              <View style={styles.statusHeader}>
                <Badge variant="default">Active Code</Badge>
                <Text variant="muted" style={{ fontSize: 13 }}>
                  Expires {formatDate(status.activeCode.expiresAt)}
                </Text>
              </View>
              {canIssue ? (
                <View style={styles.actionRow}>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={working}
                    onPress={revoke}
                    style={{ flex: 1 }}
                  >
                    Revoke code
                  </Button>
                  <Button
                    size="sm"
                    loading={working}
                    onPress={issue}
                    style={{ flex: 1 }}
                  >
                    Reissue
                  </Button>
                </View>
              ) : (
                <Text variant="muted" style={{ fontSize: 12 }}>
                  Only administrators can issue or revoke the school join code.
                </Text>
              )}
            </CardContent>
          </Card>
        ) : status?.expired ? (
          <Card>
            <CardContent style={styles.statusContent}>
              <View style={styles.statusHeader}>
                <Badge variant="outline">Expired</Badge>
                <Text variant="muted" style={{ fontSize: 13 }}>
                  The previous join code has expired.
                </Text>
              </View>
              {canIssue ? (
                <Button size="sm" loading={working} onPress={issue}>
                  Issue new code
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent style={styles.statusContent}>
              <View style={{ gap: 4 }}>
                <Text weight="600">No active join code</Text>
                <Text variant="muted" style={{ fontSize: 13 }}>
                  Issue a code to allow students to join your school.
                </Text>
              </View>
              {canIssue ? (
                <Button size="sm" loading={working} onPress={issue}>
                  Issue join code
                </Button>
              ) : (
                <Text variant="muted" style={{ fontSize: 12 }}>
                  Only administrators can issue a school join code.
                </Text>
              )}
            </CardContent>
          </Card>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  codeText: {
    fontFamily: "monospace",
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 2,
  },
  statusContent: {
    padding: 16,
    gap: 12,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
});
