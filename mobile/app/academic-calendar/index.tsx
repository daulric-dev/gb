import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarDays, Pencil, Plus } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { formatDate } from "@/lib/utils";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { Switch } from "@/components/ui/Switch";
import { Tabs } from "@/components/ui/Tabs";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { YearForm } from "@/features/academic-calendar/YearForm";
import { TermsTab } from "@/features/academic-calendar/TermsTab";
import {
  gradingModelLabel,
  sortYearsActiveFirst,
  type AcademicYear,
} from "@/features/academic-calendar/types";

type TabValue = "years" | "terms";

export default function AcademicCalendarScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { can } = usePermissions();

  const canCreate = can("academic-year", "create");
  const canUpdate = can("academic-year", "update");

  const [tab, setTab] = useState<TabValue>("years");
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicYear | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const sortedYears = useMemo(() => sortYearsActiveFirst(years), [years]);

  const fetchYears = useCallback(() => {
    return api<AcademicYear[]>("/academic-years")
      .then((data) => setYears(data))
      .catch(() => toast.error("Failed to load academic years"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchYears();
  }, [fetchYears]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchYears().finally(() => setRefreshing(false));
  }, [fetchYears]);

  const toggleActive = async (year: AcademicYear) => {
    const action = year.is_active ? "deactivate" : "activate";
    setTogglingId(year.id);
    try {
      await api(`/academic-years/${year.id}/${action}`, {
        method: "PATCH",
        body: {},
      });
      toast.success(
        year.is_active ? "Academic year deactivated" : "Academic year activated",
      );
      await fetchYears();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${action}`);
    } finally {
      setTogglingId(null);
    }
  };

  const yearsPanel = loading ? (
    <View style={{ gap: 12 }}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} style={{ height: 120, borderRadius: 16 }} />
      ))}
    </View>
  ) : sortedYears.length === 0 ? (
    <EmptyState
      icon={CalendarDays}
      title="No academic years yet"
      description="Create your first academic year to get started."
      action={
        canCreate ? (
          <Button
            size="sm"
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            icon={<Plus size={16} color={colors.primaryForeground} />}
          >
            New Academic Year
          </Button>
        ) : undefined
      }
    />
  ) : (
    <View style={{ gap: 12 }}>
      {sortedYears.map((year) => (
        <Card key={year.id}>
          <CardContent style={styles.yearCard}>
            <View style={styles.yearTop}>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={styles.yearTitle}>
                  <Text weight="600" style={{ fontSize: 16 }}>
                    {year.name}
                  </Text>
                  {year.is_active ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </View>
                <Text variant="muted" style={{ fontSize: 13 }}>
                  {formatDate(year.start_date)} – {formatDate(year.end_date)}
                </Text>
                <View style={{ flexDirection: "row" }}>
                  <Badge variant="outline">
                    {gradingModelLabel(year.grading_model)}
                  </Badge>
                </View>
                {year.year_exam_weight != null ? (
                  <Text variant="muted" style={{ fontSize: 12 }}>
                    Exam {year.year_exam_weight}% · CW{" "}
                    {year.year_coursework_weight}%
                  </Text>
                ) : null}
              </View>
              {canUpdate ? (
                <Pressable
                  hitSlop={6}
                  onPress={() => {
                    setEditing(year);
                    setFormOpen(true);
                  }}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Pencil size={18} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>

            {canUpdate ? (
              <View style={[styles.activeRow, { borderTopColor: colors.border }]}>
                <Text variant="muted" style={{ fontSize: 13 }}>
                  {year.is_active ? "Active year" : "Set as active"}
                </Text>
                <Switch
                  value={year.is_active}
                  disabled={togglingId !== null}
                  onValueChange={() => toggleActive(year)}
                />
              </View>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </View>
  );

  return (
    <Screen
      title="Academic Calendar"
      description="Manage academic years and the terms within each year"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
      action={
        canCreate && tab === "years" ? (
          <Button
            size="sm"
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            icon={<Plus size={16} color={colors.primaryForeground} />}
          >
            New
          </Button>
        ) : undefined
      }
    >
      <Tabs<TabValue>
        tabs={[
          { value: "years", label: "Academic Years" },
          { value: "terms", label: "Terms" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "years" ? (
        yearsPanel
      ) : (
        <TermsTab years={sortedYears} yearsLoading={loading} />
      )}

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Academic Year" : "Create Academic Year"}
        description={
          editing
            ? "Update academic year details"
            : "Add a new academic year for your school"
        }
      >
        {formOpen ? (
          <YearForm
            year={editing ?? undefined}
            onSuccess={() => {
              setFormOpen(false);
              fetchYears();
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  yearCard: {
    padding: 16,
    gap: 12,
  },
  yearTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  yearTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  activeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  iconBtn: {
    padding: 6,
  },
});
