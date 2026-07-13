import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Lock, Pencil, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { capitalize } from "@/lib/utils";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { RoleForm } from "@/features/roles/RoleForm";
import { PermissionsEditor } from "@/features/roles/PermissionsEditor";
import type { CatalogEntry, SchoolRole } from "@/features/roles/types";

export default function RolesScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { isAdmin, loading: permsLoading } = usePermissions();

  const [roles, setRoles] = useState<SchoolRole[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolRole | null>(null);
  const [permsRole, setPermsRole] = useState<SchoolRole | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SchoolRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRoles = useCallback(() => {
    return api<SchoolRole[]>("/permissions/roles")
      .then((data) => setRoles(data))
      .catch(() => toast.error("Failed to load roles"));
  }, [toast]);

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      fetchRoles(),
      api<CatalogEntry[]>("/permissions/catalog")
        .then((data) => setCatalog(data))
        .catch(() => toast.error("Failed to load permission catalog")),
    ]).finally(() => setLoading(false));
  }, [isAdmin, fetchRoles, toast]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRoles().finally(() => setRefreshing(false));
  }, [fetchRoles]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (role: SchoolRole) => {
    setEditing(role);
    setFormOpen(true);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api(`/permissions/roles/${confirmDelete.id}`, { method: "DELETE" });
      setRoles((cur) => cur.filter((r) => r.id !== confirmDelete.id));
      toast.success(`"${confirmDelete.name}" deleted`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete role");
    } finally {
      setDeleting(false);
    }
  };

  // Admin gate — mirrors the web page's "Admins only" state.
  if (!permsLoading && !isAdmin) {
    return (
      <Screen
        title="Roles & Permissions"
        description="Define custom roles for your school"
        onBack={() => router.back()}
      >
        <EmptyState
          icon={Lock}
          title="Admins only"
          description="Only school administrators can manage roles and permissions."
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Roles & Permissions"
      description="Create custom roles and choose what each can do"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
      action={
        <Button
          size="sm"
          onPress={openCreate}
          icon={<Plus size={16} color={colors.primaryForeground} />}
        >
          New
        </Button>
      }
    >
      {loading || permsLoading ? (
        <View style={{ gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 96, borderRadius: 14 }} />
          ))}
        </View>
      ) : roles.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No roles yet"
          description="Create a custom role to control what members can do."
          action={
            <Button
              onPress={openCreate}
              icon={<Plus size={16} color={colors.primaryForeground} />}
            >
              New role
            </Button>
          }
        />
      ) : (
        <View style={{ gap: 12 }}>
          {roles.map((role) => (
            <Card key={role.id}>
              <CardHeader style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  {role.is_system ? (
                    <ShieldCheck size={16} color={colors.mutedForeground} />
                  ) : null}
                  <CardTitle>{capitalize(role.name)}</CardTitle>
                </View>
                {role.is_system ? <Badge variant="secondary">System</Badge> : null}
              </CardHeader>
              <CardContent style={{ paddingTop: 0, gap: 12 }}>
                {role.description ? (
                  <CardDescription>{role.description}</CardDescription>
                ) : null}
                {role.is_system ? (
                  <Text variant="muted">
                    Built-in role — permissions are managed by the system.
                  </Text>
                ) : (
                  <View style={styles.actions}>
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => setPermsRole(role)}
                      icon={
                        <SlidersHorizontal size={15} color={colors.foreground} />
                      }
                    >
                      Edit permissions
                    </Button>
                    <View style={{ flex: 1 }} />
                    <IconBtn onPress={() => openEdit(role)}>
                      <Pencil size={18} color={colors.mutedForeground} />
                    </IconBtn>
                    <IconBtn onPress={() => setConfirmDelete(role)}>
                      <Trash2 size={18} color={colors.destructive} />
                    </IconBtn>
                  </View>
                )}
              </CardContent>
            </Card>
          ))}
        </View>
      )}

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit role" : "Create role"}
        description={
          editing
            ? "Update this role's name or description."
            : "Add a custom role. You can set its permissions next."
        }
      >
        {formOpen ? (
          <RoleForm
            key={editing?.id ?? "new"}
            role={editing ?? undefined}
            onSuccess={() => {
              setFormOpen(false);
              void fetchRoles();
            }}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={permsRole !== null}
        onClose={() => setPermsRole(null)}
        title={permsRole ? `Permissions · ${capitalize(permsRole.name)}` : "Permissions"}
        description="Choose what this role can do. Changes apply to every member with this role."
      >
        {permsRole ? (
          <PermissionsEditor
            key={permsRole.id}
            role={permsRole}
            catalog={catalog}
            onSaved={() => {
              setPermsRole(null);
              void fetchRoles();
            }}
          />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete role?"
        message={`The "${confirmDelete?.name}" role will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </Screen>
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBtn: {
    padding: 6,
  },
});
