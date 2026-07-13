import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyRound, Trash2, UserRound, Users } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Text } from "@/components/ui/Text";
import { Switch } from "@/components/ui/Switch";
import { Select, type SelectOption } from "@/components/ui/Select";
import type {
  FileItem,
  FileShare,
  ShareClass,
  ShareMember,
  ShareRole,
  SharePrincipalType,
} from "./types";

const TYPE_META: Record<
  SharePrincipalType,
  { label: string; icon: typeof UserRound }
> = {
  user: { label: "Person", icon: UserRound },
  role: { label: "Role", icon: KeyRound },
  group: { label: "Class", icon: Users },
};

const TYPE_OPTIONS: SelectOption<SharePrincipalType>[] = [
  { value: "user", label: "Person" },
  { value: "role", label: "Role" },
  { value: "group", label: "Class" },
];

function memberLabel(m: ShareMember): string {
  return (
    `${m.user?.first_name ?? ""} ${m.user?.last_name ?? ""}`.trim() || "Unnamed"
  );
}

/** Mirror of the web ShareDialog: add/revoke shares and toggle download. */
export function ShareSheet({
  file,
  onClose,
}: {
  file: FileItem | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [shares, setShares] = useState<FileShare[]>([]);
  const [members, setMembers] = useState<ShareMember[]>([]);
  const [roles, setRoles] = useState<ShareRole[]>([]);
  const [classes, setClasses] = useState<ShareClass[]>([]);
  const [loading, setLoading] = useState(true);

  const [newType, setNewType] = useState<SharePrincipalType>("user");
  const [newTarget, setNewTarget] = useState<string>("");
  const [newDownload, setNewDownload] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadShares = useCallback(() => {
    if (!file) return;
    api<FileShare[]>(`/files/${file.id}/shares`)
      .then(setShares)
      .catch(() => toast.error("Failed to load shares"));
  }, [file, toast]);

  useEffect(() => {
    if (!file) return;
    setLoading(true);
    setNewType("user");
    setNewTarget("");
    setNewDownload(false);
    Promise.all([
      api<ShareMember[]>("/schools/members").catch(() => []),
      api<ShareRole[]>("/permissions/roles").catch(() => []),
      api<ShareClass[]>("/classes").catch(() => []),
      api<FileShare[]>(`/files/${file.id}/shares`).catch(() => []),
    ])
      .then(([m, r, c, s]) => {
        setMembers(m);
        setRoles(r);
        setClasses(c);
        setShares(s);
      })
      .finally(() => setLoading(false));
  }, [file]);

  // Candidate targets for the current type, excluding already-shared principals.
  const targetOptions = (): SelectOption<string>[] => {
    const taken = new Set(
      shares.filter((s) => s.principal_type === newType).map((s) => s.principal_id),
    );
    if (newType === "user") {
      return members
        .filter((m) => m.user && !taken.has(m.user.id))
        .map((m) => ({ value: m.user!.id, label: memberLabel(m) }));
    }
    if (newType === "role") {
      return roles
        .filter((r) => !taken.has(r.id))
        .map((r) => ({ value: r.id, label: r.name }));
    }
    return classes
      .filter((c) => !taken.has(c.id))
      .map((c) => ({ value: c.id, label: c.name ?? "Unnamed class" }));
  };

  const principalName = (share: FileShare): string => {
    if (share.principal_type === "user") {
      const m = members.find((x) => x.user?.id === share.principal_id);
      return m ? memberLabel(m) : "Unknown person";
    }
    if (share.principal_type === "role") {
      return roles.find((x) => x.id === share.principal_id)?.name ?? "Role";
    }
    return (
      classes.find((x) => x.id === share.principal_id)?.name ?? "Class"
    );
  };

  const addShare = async () => {
    if (!file || !newTarget) return;
    setBusy(true);
    try {
      await api(`/files/${file.id}/shares`, {
        method: "POST",
        body: {
          shares: [
            {
              principalType: newType,
              principalId: newTarget,
              canDownload: newDownload,
            },
          ],
        },
      });
      toast.success("File shared");
      setNewTarget("");
      setNewDownload(false);
      loadShares();
    } catch {
      toast.error("Failed to share");
    } finally {
      setBusy(false);
    }
  };

  const toggleDownload = async (share: FileShare, value: boolean) => {
    if (!file) return;
    try {
      await api(`/files/${file.id}/shares/${share.id}`, {
        method: "PATCH",
        body: { canDownload: value },
      });
      loadShares();
    } catch {
      toast.error("Failed to update share");
    }
  };

  const revoke = async (share: FileShare) => {
    if (!file) return;
    try {
      await api(`/files/${file.id}/shares/${share.id}`, { method: "DELETE" });
      loadShares();
    } catch {
      toast.error("Failed to revoke share");
    }
  };

  const options = targetOptions();

  return (
    <Sheet
      open={file !== null}
      onClose={onClose}
      title={file ? `Share "${file.name}"` : "Share"}
      description="Recipients can view the file. Allow download to also let them save a copy."
    >
      {/* Add a recipient */}
      <View
        style={[styles.addBox, { borderColor: colors.border }]}
      >
        <View style={{ gap: 6 }}>
          <Label>Share with</Label>
          <Select
            value={newType}
            options={TYPE_OPTIONS}
            onChange={(v) => {
              setNewType(v);
              setNewTarget("");
            }}
          />
        </View>
        <View style={{ gap: 6 }}>
          <Label>{TYPE_META[newType].label}</Label>
          <Select
            value={newTarget}
            options={options}
            onChange={setNewTarget}
            placeholder={`Select ${TYPE_META[newType].label.toLowerCase()}…`}
          />
        </View>
        <View style={styles.addFooter}>
          <View style={styles.switchRow}>
            <Switch value={newDownload} onValueChange={setNewDownload} />
            <Text>Allow download</Text>
          </View>
          <Button
            size="sm"
            onPress={addShare}
            loading={busy}
            disabled={!newTarget}
          >
            Share
          </Button>
        </View>
      </View>

      {/* Existing shares */}
      <View style={{ gap: 8 }}>
        <Label>Shared with</Label>
        {loading ? (
          <Text variant="muted">Loading…</Text>
        ) : shares.length === 0 ? (
          <Text variant="muted">Not shared with anyone yet.</Text>
        ) : (
          shares.map((share) => {
            const Icon = TYPE_META[share.principal_type].icon;
            return (
              <View
                key={share.id}
                style={[styles.shareRow, { borderColor: colors.border }]}
              >
                <Icon size={16} color={colors.mutedForeground} />
                <Text style={{ flex: 1 }} numberOfLines={1}>
                  {principalName(share)}
                </Text>
                <Switch
                  value={share.can_download}
                  onValueChange={(v) => toggleDownload(share, v)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => revoke(share)}
                  icon={<Trash2 size={16} color={colors.destructive} />}
                />
              </View>
            );
          })
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  addBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  addFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
  },
});
