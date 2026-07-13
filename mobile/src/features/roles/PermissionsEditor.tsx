import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { capitalize } from "@/lib/utils";
import { Text } from "@/components/ui/Text";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CatalogEntry, PermissionAction, SchoolRole } from "./types";

const ACTION_ORDER: PermissionAction[] = ["read", "create", "update", "delete"];
const ACTION_LABEL: Record<PermissionAction, string> = {
  read: "View",
  create: "Create",
  update: "Edit",
  delete: "Delete",
};

/** Turn a resource slug ("grade-scales") into a header ("Grade Scales"). */
function prettyResource(resource: string): string {
  return resource
    .split(/[-_]/)
    .map((word) => capitalize(word))
    .join(" ");
}

/**
 * Permissions editor for a single custom role. Loads the role's current
 * permission keys, lets each catalog action be toggled, and PUTs the selected
 * keys on save. Rendered inside a Sheet — mount it keyed by role id so it
 * fetches fresh each time it opens. Mirrors the web `PermissionsEditor`.
 */
export function PermissionsEditor({
  role,
  catalog,
  onSaved,
}: {
  role: SchoolRole;
  catalog: CatalogEntry[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const { colors } = useTheme();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<string[]>(`/permissions/roles/${role.id}/permissions`)
      .then((keys) => setSelected(new Set(keys)))
      .catch(() => toast.error("Failed to load role permissions"))
      .finally(() => setLoading(false));
  }, [role.id, toast]);

  // Catalog grouped by resource, preserving catalog order.
  const groups = useMemo(() => {
    const byResource = new Map<string, Map<PermissionAction, CatalogEntry>>();
    for (const entry of catalog) {
      if (!byResource.has(entry.resource)) {
        byResource.set(entry.resource, new Map());
      }
      byResource.get(entry.resource)!.set(entry.action, entry);
    }
    return [...byResource.entries()];
  }, [catalog]);

  const toggle = (key: string, on: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/permissions/roles/${role.id}/permissions`, {
        method: "PUT",
        body: { keys: [...selected] },
      });
      toast.success(`Permissions updated for ${role.name}`);
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to save permissions",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ gap: 12 }}>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} style={{ height: 56, borderRadius: 12 }} />
        ))}
      </View>
    );
  }

  return (
    <View style={{ gap: 20 }}>
      {groups.map(([resource, actions]) => (
        <View key={resource} style={{ gap: 8 }}>
          <Text variant="subtitle">{prettyResource(resource)}</Text>
          <View style={[styles.group, { borderColor: colors.border }]}>
            {ACTION_ORDER.filter((action) => actions.has(action)).map(
              (action, index) => {
                const entry = actions.get(action)!;
                const on = selected.has(entry.key);
                return (
                  <View
                    key={action}
                    style={[
                      styles.row,
                      {
                        borderColor: colors.border,
                        borderTopWidth:
                          index === 0 ? 0 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text weight="500">{ACTION_LABEL[action]}</Text>
                      {entry.description ? (
                        <Text variant="muted" style={{ marginTop: 2 }}>
                          {entry.description}
                        </Text>
                      ) : null}
                    </View>
                    <Switch
                      value={on}
                      onValueChange={(v) => toggle(entry.key, v)}
                    />
                  </View>
                );
              },
            )}
          </View>
        </View>
      ))}

      <View style={styles.footer}>
        <Text variant="muted">
          {selected.size} permission{selected.size === 1 ? "" : "s"} selected
        </Text>
        <Button onPress={save} loading={saving}>
          Save Permissions
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  footer: {
    gap: 12,
  },
});
