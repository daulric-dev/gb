import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Check,
  GraduationCap,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScaleForm } from "@/features/grade-scales/ScaleForm";
import type {
  GradeScaleDetail,
  GradeScaleSummary,
  GradeScaleType,
} from "@/features/grade-scales/types";

const TYPE_LABEL: Record<GradeScaleType, string> = {
  letter: "Letter (A–F)",
  gpa: "GPA",
  pass_fail: "Pass / Fail",
};

export default function GradeScalesScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { isAdmin, loading: permsLoading } = usePermissions();

  const [scales, setScales] = useState<GradeScaleDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GradeScaleDetail | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GradeScaleDetail | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  // The list endpoint returns summaries only, so fetch each scale's detail in
  // parallel to know its band count and to open the editor without a round-trip.
  const fetchScales = useCallback(async () => {
    try {
      const summaries = await api<GradeScaleSummary[]>("/grade-scales");
      const details = await Promise.all(
        summaries.map((s) =>
          api<GradeScaleDetail>(`/grade-scales/${s.id}`).catch(
            () => ({ ...s, bands: [] }) as GradeScaleDetail,
          ),
        ),
      );
      setScales(details);
    } catch {
      toast.error("Failed to load grade scales");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    if (permsLoading || !isAdmin) {
      if (!permsLoading) setLoading(false);
      return;
    }
    void fetchScales();
  }, [permsLoading, isAdmin, fetchScales]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchScales();
  };

  const setAsDefault = async (id: string) => {
    setSettingDefault(id);
    try {
      await api(`/grade-scales/${id}/set-default`, { method: "POST" });
      toast.success("Default scale updated");
      await fetchScales();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to set default");
    } finally {
      setSettingDefault(null);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api(`/grade-scales/${confirmDelete.id}`, { method: "DELETE" });
      toast.success("Scale deleted");
      setConfirmDelete(null);
      await fetchScales();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete scale");
    } finally {
      setDeleting(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (scale: GradeScaleDetail) => {
    setEditing(scale);
    setFormOpen(true);
  };

  const action =
    isAdmin && !permsLoading ? (
      <Button
        size="sm"
        onPress={openCreate}
        icon={<Plus size={16} color={colors.primaryForeground} />}
      >
        New
      </Button>
    ) : undefined;

  return (
    <Screen
      title="Grade Scales"
      description="Configure how numeric grades are displayed in your school"
      onBack={() => router.back()}
      action={action}
      refreshing={refreshing}
      onRefresh={isAdmin ? onRefresh : undefined}
    >
      {permsLoading ? (
        <Skeleton style={{ height: 96, borderRadius: 12 }} />
      ) : !isAdmin ? (
        <Card>
          <CardContent style={styles.centered}>
            <Text variant="muted" style={{ textAlign: "center" }}>
              Only school administrators can manage grade scales.
            </Text>
          </CardContent>
        </Card>
      ) : loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 84, borderRadius: 12 }} />
          <Skeleton style={{ height: 84, borderRadius: 12 }} />
        </View>
      ) : scales.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No grade scales yet"
          description="Create a scale to map numeric percentages to a display value."
          action={
            <Button
              onPress={openCreate}
              icon={<Plus size={16} color={colors.primaryForeground} />}
            >
              New scale
            </Button>
          }
        />
      ) : (
        <View style={{ gap: 12 }}>
          {scales.map((s) => (
            <Card key={s.id}>
              <CardContent style={styles.scaleContent}>
                <View style={styles.scaleTop}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text weight="600" style={{ fontSize: 16 }}>
                      {s.name}
                    </Text>
                    <View style={styles.badges}>
                      <Badge variant="outline">
                        {TYPE_LABEL[s.scaleType] ?? s.scaleType}
                      </Badge>
                      {s.isDefault ? <Badge variant="default">Default</Badge> : null}
                    </View>
                    <Text variant="muted" style={{ fontSize: 12 }}>
                      {s.bands.length} band{s.bands.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                </View>

                <View style={styles.actions}>
                  {!s.isDefault ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={settingDefault === s.id}
                      loading={settingDefault === s.id}
                      onPress={() => setAsDefault(s.id)}
                      icon={<Star size={15} color={colors.foreground} />}
                    >
                      Set default
                    </Button>
                  ) : (
                    <View style={styles.isDefaultHint}>
                      <Check size={15} color={colors.mutedForeground} />
                      <Text variant="muted" style={{ fontSize: 13 }}>
                        Default
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => openEdit(s)}
                    icon={<Pencil size={15} color={colors.foreground} />}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => setConfirmDelete(s)}
                    icon={<Trash2 size={15} color={colors.destructive} />}
                  >
                    Delete
                  </Button>
                </View>
              </CardContent>
            </Card>
          ))}
        </View>
      )}

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit grade scale" : "New grade scale"}
        description="Define the bands that map numeric percentages to a display value."
      >
        {formOpen ? (
          <ScaleForm
            existing={editing}
            onSaved={() => {
              setFormOpen(false);
              void fetchScales();
            }}
          />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete grade scale?"
        message={`"${confirmDelete?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  scaleContent: {
    gap: 14,
  },
  scaleTop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  isDefaultHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});
