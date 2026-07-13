import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Label } from "@/components/ui/Label";
import { Text } from "@/components/ui/Text";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TermForm } from "./TermForm";
import {
  MAX_TERMS,
  TERM_LABELS,
  gradingModelLabel,
  type AcademicYear,
  type Term,
} from "./types";

/**
 * Terms tab: pick an academic year, then view / create / edit / delete its
 * terms. Mirrors the web TermsTab, adapted to a single-year `Select` picker.
 */
export function TermsTab({
  years,
  yearsLoading,
}: {
  years: AcademicYear[];
  yearsLoading: boolean;
}) {
  const toast = useToast();
  const { colors } = useTheme();
  const { can } = usePermissions();

  const canCreate = can("term", "create");
  const canUpdate = can("term", "update");
  const canDelete = can("term", "delete");

  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Term | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Term | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selectedYear = years.find((y) => y.id === yearId) ?? null;

  // Default to the first (active-first sorted) year once years arrive.
  useEffect(() => {
    if (years.length === 0) {
      setYearId("");
      return;
    }
    setYearId((cur) => (years.some((y) => y.id === cur) ? cur : years[0].id));
  }, [years]);

  const fetchTerms = useCallback(() => {
    if (!yearId) {
      setTerms([]);
      setLoading(false);
      return Promise.resolve();
    }
    setLoading(true);
    return api<Term[]>(`/terms?yearId=${yearId}`)
      .then((data) => setTerms(data))
      .catch(() => toast.error("Failed to load terms"))
      .finally(() => setLoading(false));
  }, [yearId, toast]);

  useEffect(() => {
    fetchTerms();
  }, [fetchTerms]);

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api(`/terms/${confirmDelete.id}`, { method: "DELETE" });
      toast.success("Term deleted");
      setConfirmDelete(null);
      fetchTerms();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  if (yearsLoading) {
    return <Skeleton style={{ height: 120, borderRadius: 16 }} />;
  }

  if (years.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No academic years yet"
        description="Create one in the Academic Years tab first."
      />
    );
  }

  const canAdd = terms.length < MAX_TERMS;
  const existingNames = terms.map((t) => t.name);

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Label>Academic Year</Label>
        <Select
          value={yearId}
          onChange={setYearId}
          options={years.map((y) => ({ value: y.id, label: y.name }))}
        />
      </View>

      {selectedYear ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {selectedYear.is_active ? (
            <Badge variant="default">Active</Badge>
          ) : (
            <Badge variant="secondary">Inactive</Badge>
          )}
          <Badge variant="outline">
            {gradingModelLabel(selectedYear.grading_model)}
          </Badge>
        </View>
      ) : null}

      {canCreate ? (
        <Button
          size="sm"
          disabled={!canAdd || !yearId}
          onPress={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          icon={<Plus size={16} color={colors.primaryForeground} />}
        >
          {canAdd ? "Add Term" : "Max 3 terms"}
        </Button>
      ) : null}

      {loading ? (
        <View style={{ gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 72, borderRadius: 12 }} />
          ))}
        </View>
      ) : terms.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No terms yet"
          description="Terms added to this academic year will appear here."
        />
      ) : (
        <View style={{ gap: 8 }}>
          {terms.map((term) => (
            <Card key={term.id}>
              <CardContent style={styles.termRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.termTitle}>
                    <Text weight="600">{TERM_LABELS[term.name]}</Text>
                    {term.is_ministry_reporting ? (
                      <Badge variant="default">Ministry</Badge>
                    ) : null}
                  </View>
                  <Text variant="muted" style={{ fontSize: 13 }}>
                    {formatDate(term.start_date)} – {formatDate(term.end_date)}
                  </Text>
                  <Text variant="muted" style={{ fontSize: 13 }}>
                    Exam {term.exam_weight}% · CW {term.coursework_weight}%
                  </Text>
                </View>
                <View style={styles.actions}>
                  {canUpdate ? (
                    <IconBtn
                      onPress={() => {
                        setEditing(term);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil size={18} color={colors.mutedForeground} />
                    </IconBtn>
                  ) : null}
                  {canDelete ? (
                    <IconBtn onPress={() => setConfirmDelete(term)}>
                      <Trash2 size={18} color={colors.destructive} />
                    </IconBtn>
                  ) : null}
                </View>
              </CardContent>
            </Card>
          ))}
        </View>
      )}

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Term" : "Create Term"}
        description={
          editing
            ? "Update term details"
            : `Add a term to ${selectedYear?.name ?? "the selected year"}`
        }
      >
        {formOpen ? (
          <TermForm
            term={editing ?? undefined}
            academicYearId={yearId}
            existingNames={existingNames}
            onSuccess={() => {
              setFormOpen(false);
              fetchTerms();
            }}
          />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete term?"
        message={
          confirmDelete
            ? `The ${TERM_LABELS[confirmDelete.name]} term will be removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </View>
  );
}

function IconBtn({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  termRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 16,
  },
  termTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 4,
  },
  iconBtn: {
    padding: 6,
  },
});
