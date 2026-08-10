import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { GraduationCap, LogOut, Plus, Search } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { AuthShell } from "@/components/auth/AuthShell";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

interface School {
  id: string;
  name: string;
  parish: string | null;
  school_type: string | null;
}

function CreateSchool({ onCreated }: { onCreated: (s: School) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<"primary" | "secondary">("secondary");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!name.trim()) {
      toast.error("Enter a school name");
      return;
    }
    setLoading(true);
    try {
      const school = await api<School>("/schools", {
        method: "POST",
        body: { name: name.trim(), schoolType: type },
        skipAuthRedirect: true,
      });
      onCreated(school);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to create school",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent style={{ gap: 14 }}>
        <Text variant="subtitle">Create a school</Text>
        <Text variant="muted" style={{ marginTop: -6 }}>
          You&apos;ll be assigned as its admin.
        </Text>
        <View>
          <Label>School name</Label>
          <Input
            placeholder="GradeBook Academy"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        </View>
        <View>
          <Label>Type</Label>
          <SegmentedControl<"primary" | "secondary">
            value={type}
            onChange={setType}
            options={[
              { value: "primary", label: "Primary" },
              { value: "secondary", label: "Secondary" },
            ]}
          />
        </View>
        <Button onPress={submit} loading={loading}>
          Create school
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SchoolsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { profile, refresh, logout } = useAuth();

  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    Promise.all([
      api<School[]>("/schools", { skipAuthRedirect: true }).catch(
        () => [] as School[],
      ),
      api<{ school_id: string } | null>("/schools/my-pending-request", {
        skipAuthRedirect: true,
      }).catch(() => null),
    ])
      .then(([list, pending]) => {
        setSchools(list);
        if (pending?.school_id) setPendingId(pending.school_id);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.parish?.toLowerCase().includes(q),
    );
  }, [schools, search]);

  async function join(school: School) {
    setJoiningId(school.id);
    try {
      const result = await api<{ autoJoined?: boolean }>(
        `/schools/${school.id}/join-requests`,
        { method: "POST", skipAuthRedirect: true },
      );
      if (result?.autoJoined) {
        toast.success(`You've joined ${school.name}!`);
        await refresh();
        router.replace("/(tabs)");
      } else {
        setPendingId(school.id);
        setJoiningId(null);
        toast.success(`Join request sent — waiting for admin approval.`);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to request to join",
      );
      setJoiningId(null);
    }
  }

  async function onCreated(school: School) {
    toast.success(`${school.name} created! You're the admin.`);
    await refresh();
    router.replace("/(tabs)");
  }

  async function handleLogout() {
    await logout();
    router.replace("/(auth)/login");
  }

  const displayName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name ?? ""}`.trim()
    : "";
  const anyPending = pendingId !== null;

  return (
    <AuthShell>
      <View style={{ gap: 20 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <GraduationCap size={36} color={colors.primary} />
          <Text variant="title" style={{ textAlign: "center" }}>
            {displayName ? `Welcome, ${displayName}` : "Choose a school"}
          </Text>
          <Text variant="muted" style={{ textAlign: "center" }}>
            Create your own school or request to join an existing one.
          </Text>
        </View>

        {showCreate ? (
          <CreateSchool onCreated={onCreated} />
        ) : (
          <Button
            variant="outline"
            onPress={() => setShowCreate(true)}
            icon={<Plus size={16} color={colors.foreground} />}
          >
            Create a school
          </Button>
        )}

        <Card>
          <CardContent style={{ gap: 12 }}>
            <Text variant="subtitle">Schools</Text>
            {!loading && schools.length > 5 && (
              <View style={{ justifyContent: "center" }}>
                <Search
                  size={16}
                  color={colors.mutedForeground}
                  style={styles.searchIcon}
                />
                <Input
                  placeholder="Search schools..."
                  value={search}
                  onChangeText={setSearch}
                  autoCapitalize="none"
                  style={{ paddingLeft: 36 }}
                />
              </View>
            )}

            {loading ? (
              <View style={{ gap: 8 }}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} style={{ height: 56, borderRadius: 10 }} />
                ))}
              </View>
            ) : filtered.length === 0 ? (
              <Text variant="muted" style={styles.empty}>
                {schools.length === 0
                  ? "No schools available yet — create one above."
                  : "No schools match your search."}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                <View style={{ gap: 8 }}>
                  {filtered.map((school) => {
                    const isPending = pendingId === school.id;
                    const isJoining = joiningId === school.id;
                    return (
                      <View
                        key={school.id}
                        style={[styles.row, { borderColor: colors.border }]}
                      >
                        <GraduationCap
                          size={18}
                          color={colors.mutedForeground}
                        />
                        <View style={{ flex: 1 }}>
                          <Text weight="600" numberOfLines={1}>
                            {school.name}
                          </Text>
                          {school.parish ? (
                            <Text variant="muted" style={{ fontSize: 12 }}>
                              {school.parish}
                            </Text>
                          ) : null}
                        </View>
                        {isPending ? (
                          <Text variant="muted" style={{ fontSize: 12 }}>
                            Pending
                          </Text>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={isJoining}
                            disabled={anyPending || joiningId !== null}
                            onPress={() => join(school)}
                          >
                            Request
                          </Button>
                        )}
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </CardContent>
        </Card>

        <Button
          variant="ghost"
          onPress={handleLogout}
          icon={<LogOut size={16} color={colors.foreground} />}
        >
          Log out
        </Button>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  searchIcon: {
    position: "absolute",
    left: 11,
    zIndex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  empty: {
    textAlign: "center",
    paddingVertical: 24,
  },
});
