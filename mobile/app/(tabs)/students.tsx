import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Search, Plus } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import type { Student } from "@/lib/types";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet } from "@/components/ui/Sheet";
import { StudentForm } from "@/features/students/StudentForm";
import { getInitials, capitalize } from "@/lib/utils";

function StudentRow({
  student,
  onPress,
}: {
  student: Student;
  onPress?: () => void;
}) {
  const fullName = `${student.first_name} ${student.last_name}`.trim();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card>
        <CardContent style={styles.row}>
          <Avatar
            fallback={getInitials(student.first_name, student.last_name)}
            size={40}
          />
          <View style={{ flex: 1 }}>
            <Text weight="600" numberOfLines={1}>
              {fullName || "Unnamed student"}
            </Text>
            {student.gender ? (
              <Text variant="muted" style={{ fontSize: 12 }}>
                {capitalize(student.gender)}
              </Text>
            ) : null}
          </View>
          {!student.is_active && <Badge variant="outline">Inactive</Badge>}
        </CardContent>
      </Card>
    </Pressable>
  );
}

export default function StudentsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { can } = usePermissions();
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const initial = useRef(true);

  const canCreate = can("student", "create");
  const canUpdate = can("student", "update");

  const fetchStudents = useCallback(
    async (query?: string) => {
      const params = query
        ? `?search=${encodeURIComponent(query)}`
        : "";
      try {
        const data = await api<Student[]>(`/students${params}`);
        setStudents(data);
      } catch {
        toast.error("Failed to load students");
      }
    },
    [toast],
  );

  useEffect(() => {
    fetchStudents().finally(() => setLoading(false));
  }, [fetchStudents]);

  // Debounced search, skipping the initial mount (handled above).
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      void fetchStudents(search);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, fetchStudents]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStudents(search).finally(() => setRefreshing(false));
  }, [fetchStudents, search]);

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <Screen
      title="Students"
      description="Students in your school"
      refreshing={refreshing}
      onRefresh={onRefresh}
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
            New
          </Button>
        ) : undefined
      }
    >
      <View style={styles.searchWrap}>
        <Search
          size={18}
          color={colors.mutedForeground}
          style={styles.searchIcon}
        />
        <Input
          placeholder="Search students..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ paddingLeft: 38 }}
        />
      </View>

      {loading ? (
        <View style={{ gap: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} style={{ height: 72, borderRadius: 14 }} />
          ))}
        </View>
      ) : students.length === 0 ? (
        <Text variant="muted" style={styles.empty}>
          {search ? "No students match your search." : "No students yet."}
        </Text>
      ) : (
        <View style={{ gap: 12 }}>
          {students.map((s) => (
            <StudentRow
              key={s.id}
              student={s}
              onPress={
                canUpdate
                  ? () => {
                      setEditing(s);
                      setFormOpen(true);
                    }
                  : undefined
              }
            />
          ))}
        </View>
      )}

      <Sheet
        open={formOpen}
        onClose={closeForm}
        title={editing ? "Edit Student" : "Add Student"}
      >
        <StudentForm
          student={editing ?? undefined}
          onSuccess={() => {
            closeForm();
            fetchStudents(search);
          }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    justifyContent: "center",
  },
  searchIcon: {
    position: "absolute",
    left: 12,
    zIndex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  empty: {
    textAlign: "center",
    paddingVertical: 40,
  },
});
