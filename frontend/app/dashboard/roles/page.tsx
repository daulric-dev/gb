"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Lock, Pencil, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { RoleFormDialog } from "./_components/RoleFormDialog";
import { PermissionsEditor } from "./_components/PermissionsEditor";
import type { CatalogEntry, SchoolRole } from "./_components/types";

export default function RolesPage() {
  useSignals();
  const { profile, loading: profileLoading } = useProfile();
  const isAdmin = profile.value?.role === "admin";

  const roles = useSignal<SchoolRole[]>([]);
  const catalog = useSignal<CatalogEntry[]>([]);
  const loading = useSignal(true);
  const deletingId = useSignal<string | null>(null);

  const formOpen = useSignal(false);
  const editingRole = useSignal<SchoolRole | null>(null);
  const permsOpen = useSignal(false);
  const permsRole = useSignal<SchoolRole | null>(null);

  const fetchRoles = useCallback(() => {
    loading.value = true;
    api<SchoolRole[]>("/permissions/roles")
      .then((data) => (roles.value = data))
      .catch(() => toast.error("Failed to load roles"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchRoles();
    api<CatalogEntry[]>("/permissions/catalog")
      .then((data) => (catalog.value = data))
      .catch(() => toast.error("Failed to load permission catalog"));
  }, [isAdmin, fetchRoles]);

  function openCreate() {
    editingRole.value = null;
    formOpen.value = true;
  }

  function openEdit(role: SchoolRole) {
    editingRole.value = role;
    formOpen.value = true;
  }

  function openPermissions(role: SchoolRole) {
    permsRole.value = role;
    permsOpen.value = true;
  }

  async function handleDelete(role: SchoolRole) {
    if (!window.confirm(`Delete the "${role.name}" role? This cannot be undone.`))
      return;
    deletingId.value = role.id;
    try {
      await api(`/permissions/roles/${role.id}`, { method: "DELETE" });
      roles.value = roles.value.filter((r) => r.id !== role.id);
      toast.success(`"${role.name}" deleted`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete role");
    } finally {
      deletingId.value = null;
    }
  }

  if (profileLoading.value) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Roles & Permissions"
          description="Define custom roles for your school"
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Lock className="mb-3 size-10 text-muted-foreground/40" />
            <p className="font-medium">Admins only</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Only school administrators can manage roles and permissions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Roles & Permissions"
        description="Create custom roles and choose what each can do"
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 size-4" />
            New role
          </Button>
        }
      />

      {loading.value ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.value.map((role) => (
            <Card key={role.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base capitalize">
                    {role.is_system && (
                      <ShieldCheck className="size-4 text-muted-foreground" />
                    )}
                    {role.name}
                  </CardTitle>
                  {role.is_system && (
                    <Badge variant="secondary" className="shrink-0">
                      Built-in
                    </Badge>
                  )}
                </div>
                {role.description && (
                  <CardDescription>{role.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="mt-auto flex gap-2 pt-0">
                {role.is_system ? (
                  <p className="text-xs text-muted-foreground">
                    Built-in role - permissions are managed by the system.
                  </p>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openPermissions(role)}
                    >
                      <SlidersHorizontal className="mr-1.5 size-3.5" />
                      Permissions
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(role)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={deletingId.value === role.id}
                      onClick={() => handleDelete(role)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RoleFormDialog
        open={formOpen.value}
        role={editingRole.value}
        onOpenChange={(v) => (formOpen.value = v)}
        onSaved={fetchRoles}
      />
      <PermissionsEditor
        open={permsOpen.value}
        role={permsRole.value}
        catalog={catalog.value}
        onOpenChange={(v) => (permsOpen.value = v)}
        onSaved={fetchRoles}
      />
    </div>
  );
}
