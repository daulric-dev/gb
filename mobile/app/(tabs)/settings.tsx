import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Camera, GraduationCap, LogOut, Trash2 } from "lucide-react-native";
import { api, apiUpload, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getInitials, capitalize } from "@/lib/utils";

export default function SettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { profile, logout, refresh } = useAuth();
  const { colors, mode, setMode } = useTheme();

  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const displayName =
    profile?.first_name || profile?.last_name
      ? `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim()
      : (profile?.email ?? "User");

  const hasChanges =
    firstName.trim() !== (profile?.first_name ?? "") ||
    lastName.trim() !== (profile?.last_name ?? "");

  async function handleLogout() {
    await logout();
    toast.success("Logged out");
    router.replace("/(auth)/login");
  }

  async function saveProfile() {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    setSaving(true);
    try {
      await api("/auth/profile", {
        method: "PATCH",
        body: { firstName: firstName.trim(), lastName: lastName.trim() },
      });
      await refresh();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function pickAndUploadAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.error("Photo library permission is required");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", {
        uri: asset.uri,
        name: asset.fileName ?? "avatar.jpg",
        type: asset.mimeType ?? "image/jpeg",
        // React Native's FormData file shape differs from the DOM's.
      } as unknown as Blob);
      await apiUpload<{ avatar_url: string }>("/auth/avatar", form);
      await refresh();
      toast.success("Profile picture updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to upload image");
    } finally {
      setUploading(false);
    }
  }

  async function leaveSchool() {
    setLeaving(true);
    try {
      await api("/schools/leave", { method: "POST" });
      toast.success("You have left the school");
      setLeaveOpen(false);
      await refresh();
      router.replace("/(auth)/schools");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to leave school");
      setLeaving(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api("/auth/account", { method: "DELETE" });
      toast.success("Account deleted");
      setDeleteOpen(false);
      await logout();
      router.replace("/(auth)/login");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete account");
      setDeleting(false);
    }
  }

  return (
    <Screen title="Settings" description="Manage your account">
      {/* Profile picture */}
      <Card>
        <CardContent style={styles.profileRow}>
          <Pressable onPress={pickAndUploadAvatar} disabled={uploading}>
            <Avatar
              uri={profile?.avatar_url}
              fallback={getInitials(profile?.first_name, profile?.last_name)}
              size={64}
            />
            <View style={[styles.cameraBadge, { backgroundColor: colors.primary }]}>
              <Camera size={13} color={colors.primaryForeground} />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text weight="600" style={{ fontSize: 16 }} numberOfLines={1}>
              {displayName}
            </Text>
            {profile?.email ? (
              <Text variant="muted" numberOfLines={1}>
                {profile.email}
              </Text>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onPress={pickAndUploadAvatar}
              loading={uploading}
              style={{ marginTop: 8, alignSelf: "flex-start" }}
            >
              Change Picture
            </Button>
          </View>
        </CardContent>
      </Card>

      {/* Profile form */}
      <Card>
        <CardContent style={{ gap: 14 }}>
          <Text variant="subtitle">Profile</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>First Name</Label>
              <Input value={firstName} onChangeText={setFirstName} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>Last Name</Label>
              <Input value={lastName} onChangeText={setLastName} />
            </View>
          </View>
          {profile?.role ? (
            <Text variant="muted" style={{ fontSize: 12 }}>
              Role: {capitalize(profile.role)}
            </Text>
          ) : null}
          <Button onPress={saveProfile} loading={saving} disabled={!hasChanges}>
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* School */}
      {profile?.school?.name ? (
        <Card>
          <CardContent style={styles.schoolRow}>
            <GraduationCap size={18} color={colors.mutedForeground} />
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {profile.school.name}
            </Text>
            <Button variant="outline" size="sm" onPress={() => setLeaveOpen(true)}>
              Leave
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Appearance */}
      <View style={{ gap: 8 }}>
        <Text variant="label">Appearance</Text>
        <SegmentedControl<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </View>

      <Button
        variant="outline"
        onPress={handleLogout}
        icon={<LogOut size={16} color={colors.foreground} />}
      >
        Log out
      </Button>

      {/* Danger zone */}
      <Card style={{ borderColor: colors.destructive }}>
        <CardContent style={{ gap: 10 }}>
          <Text variant="subtitle" tone="destructive">
            Danger Zone
          </Text>
          <Text variant="muted">
            Permanently delete your account and all associated data. This cannot
            be undone.
          </Text>
          <Button
            variant="destructive"
            onPress={() => setDeleteOpen(true)}
            icon={<Trash2 size={16} color={colors.destructiveForeground} />}
            style={{ alignSelf: "flex-start" }}
          >
            Delete Account
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={leaveOpen}
        title="Leave school?"
        message="You will lose access to this school's data until you rejoin."
        confirmLabel="Leave"
        destructive
        loading={leaving}
        onConfirm={leaveSchool}
        onCancel={() => setLeaveOpen(false)}
      />

      <Sheet
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirmText("");
        }}
        title="Delete Account"
        description="This permanently deletes your account and removes you from all schools."
      >
        <View style={{ gap: 12 }}>
          <Label>
            Type DELETE to confirm
          </Label>
          <Input
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="DELETE"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Button
            variant="destructive"
            disabled={confirmText !== "DELETE"}
            loading={deleting}
            onPress={deleteAccount}
          >
            Permanently Delete
          </Button>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  cameraBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  schoolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
});
