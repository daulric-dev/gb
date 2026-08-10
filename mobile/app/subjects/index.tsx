import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { BookOpen, Plus } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SubjectForm } from "@/features/subjects/SubjectForm";
import { SubjectRow } from "@/features/subjects/SubjectRow";
import type { Subject } from "@/features/subjects/types";

export default function SubjectsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { can } = usePermissions();

  const canCreate = can("subject", "create");
  const canUpdate = can("subject", "update");
  const canDelete = can("subject", "delete");

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reordering, setReordering] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSubjects = useCallback(() => {
    return api<Subject[]>("/subjects")
      .then((data) => setSubjects(data))
      .catch(() => toast.error("Failed to load subjects"))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [toast]);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchSubjects();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= subjects.length) return;

    const previous = subjects;
    const reordered = [...subjects];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);

    // Optimistically apply with recomputed sort orders.
    const withOrder = reordered.map((s, i) => ({ ...s, sort_order: i }));
    setSubjects(withOrder);

    setReordering(true);
    try {
      await api("/subjects/reorder", {
        method: "PATCH",
        body: { items: withOrder.map((s) => ({ id: s.id, sortOrder: s.sort_order })) },
      });
    } catch (err) {
      setSubjects(previous);
      toast.error(err instanceof ApiError ? err.message : "Failed to reorder");
    } finally {
      setReordering(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api(`/subjects/${confirmDelete.id}`, { method: "DELETE" });
      toast.success("Subject deleted");
      setConfirmDelete(null);
      fetchSubjects();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <Screen
      title="Subjects"
      description="Manage subjects for your school"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
      action={
        canCreate ? (
          <Button
            size="sm"
            onPress={openCreate}
            icon={<Plus size={16} color={colors.primaryForeground} />}
          >
            New
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <View style={{ gap: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 72, borderRadius: 14 }} />
          ))}
        </View>
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No subjects yet"
          description="Create your first subject to start organizing grades."
          action={
            canCreate ? (
              <Button
                onPress={openCreate}
                icon={<Plus size={16} color={colors.primaryForeground} />}
              >
                New Subject
              </Button>
            ) : undefined
          }
        />
      ) : (
        <View style={{ gap: 10 }}>
          {subjects.map((subject, index) => (
            <SubjectRow
              key={subject.id}
              subject={subject}
              canReorder={canUpdate}
              canEdit={canUpdate}
              canDelete={canDelete}
              isFirst={index === 0}
              isLast={index === subjects.length - 1}
              reordering={reordering}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onEdit={() => {
                setEditing(subject);
                setFormOpen(true);
              }}
              onDelete={() => setConfirmDelete(subject)}
            />
          ))}
        </View>
      )}

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Subject" : "Create Subject"}
        description={
          editing ? "Update subject details" : "Add a new subject for your school"
        }
      >
        <SubjectForm
          subject={editing ?? undefined}
          nextSortOrder={subjects.length}
          onSuccess={() => {
            setFormOpen(false);
            fetchSubjects();
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete subject?"
        message={`"${confirmDelete?.name}" will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </Screen>
  );
}
