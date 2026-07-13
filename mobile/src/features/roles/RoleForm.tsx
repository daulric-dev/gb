import { useState } from "react";
import { View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import type { SchoolRole } from "./types";

/**
 * Create or edit a custom role (name + description). Pass `role` to edit;
 * otherwise a new role is created. Mirrors the web `RoleFormDialog`.
 */
export function RoleForm({
  role,
  onSuccess,
}: {
  role?: SchoolRole;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const editing = !!role;

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Role name is required");
      return;
    }
    setLoading(true);
    try {
      const body = {
        name: trimmed,
        description: description.trim() || undefined,
      };
      if (editing) {
        await api(`/permissions/roles/${role.id}`, { method: "PATCH", body });
        toast.success("Role updated");
      } else {
        await api("/permissions/roles", { method: "POST", body });
        toast.success("Role created");
      }
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save role");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Label>Name</Label>
        <Input
          placeholder="e.g. Librarian"
          value={name}
          onChangeText={setName}
          maxLength={100}
          autoFocus={!editing}
        />
      </View>
      <View style={{ gap: 6 }}>
        <Label>Description</Label>
        <TextArea
          placeholder="What this role is for (optional)"
          value={description}
          onChangeText={setDescription}
          maxLength={300}
          numberOfLines={3}
        />
      </View>
      <Button onPress={submit} loading={loading}>
        {editing ? "Save Changes" : "Create Role"}
      </Button>
    </View>
  );
}
