import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  GraduationCap,
  LogOut,
  Mail,
  Plus,
  Search,
} from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { homeRouteFor, isStudentProfile } from "@/lib/routing";
import { JoinCodeForm } from "@/components/auth/JoinCodeForm";
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

/** A school that verified the domain of the signed-in user's email address. */
interface DomainMatch {
  domainId: string;
  domain: string;
  schoolId: string;
  schoolName: string;
  audience: "student" | "staff";
  autoJoin: boolean;
}

type DomainJoinResult =
  | { status: "joined"; schoolId: string; audience: "student" | "staff" }
  | { status: "requested"; schoolId: string };

/**
 * Offers the school that owns the user's email domain. Students and staff on
 * an auto-join domain get in at once; other staff send a join request.
 */
function DomainMatchCard({
  match,
  pending,
  joining,
  disabled,
  onJoin,
}: {
  match: DomainMatch;
  pending: boolean;
  joining: boolean;
  disabled: boolean;
  onJoin: () => void;
}) {
  const { colors } = useTheme();
  const direct = match.audience === "student" || match.autoJoin;
  return (
    <Card style={{ borderWidth: 1, borderColor: colors.primary }}>
      <CardContent style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Mail size={20} color={colors.primary} />
          <Text variant="subtitle" style={{ flex: 1 }}>
            Your @{match.domain} address belongs to {match.schoolName}
          </Text>
        </View>
        {pending ? (
          <Text variant="muted">
            Join request sent — waiting for admin approval.
          </Text>
        ) : (
          <>
            <Text variant="muted">
              {direct
                ? "Join now — no approval needed."
                : "An administrator approves staff before you get access."}
            </Text>
            <Button loading={joining} disabled={disabled} onPress={onJoin}>
              {direct ? `Join ${match.schoolName}` : "Ask to join"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** How often a waiting applicant re-checks whether they have been approved. */
const POLL_MS = 8000;

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
  const [match, setMatch] = useState<DomainMatch | null>(null);
  const [domainJoining, setDomainJoining] = useState(false);

  useEffect(() => {
    Promise.all([
      api<School[]>("/schools", { skipAuthRedirect: true }).catch(
        () => [] as School[],
      ),
      api<{ school_id: string } | null>("/schools/my-pending-request", {
        skipAuthRedirect: true,
      }).catch(() => null),
      api<{ match: DomainMatch | null }>("/auth/email-domain/match", {
        skipAuthRedirect: true,
      }).catch(() => ({ match: null })),
    ])
      .then(([list, pending, domain]) => {
        setSchools(list);
        setMatch(domain.match);
        if (pending?.school_id) setPendingId(pending.school_id);
      })
      .finally(() => setLoading(false));
  }, []);

  // Approval happens on the admin's screen. Without polling, an accepted
  // applicant sits on "Pending" until they reopen the app.
  useEffect(() => {
    if (!pendingId || profile?.school) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingId, profile?.school, refresh]);

  // Once the profile carries a school they belong in the app proper.
  useEffect(() => {
    if (profile?.school) router.replace(homeRouteFor(profile));
  }, [profile, router]);

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

  async function joinByDomain() {
    if (!match) return;
    setDomainJoining(true);
    try {
      const result = await api<DomainJoinResult>("/auth/email-domain/join", {
        method: "POST",
        skipAuthRedirect: true,
      });
      if (result.status === "joined") {
        toast.success(`You've joined ${match.schoolName}!`);
        // The effect above routes home once the refreshed profile has a school.
        await refresh();
      } else {
        setPendingId(result.schoolId);
        setDomainJoining(false);
        toast.success(`Join request sent — waiting for admin approval.`);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to join the school",
      );
      setDomainJoining(false);
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

  const domainCard = match ? (
    <DomainMatchCard
      match={match}
      pending={pendingId === match.schoolId}
      joining={domainJoining}
      disabled={anyPending || joiningId !== null}
      onJoin={joinByDomain}
    />
  ) : null;
  const otherWays = match ? (
    <Text variant="muted" style={{ textAlign: "center" }}>
      Or join another way
    </Text>
  ) : null;

  // A student joins by redeeming the code their school issued, so they get the
  // code field alone - no school list, no create-a-school option.
  if (isStudentProfile(profile)) {
    return (
      <AuthShell>
        <View style={{ gap: 20 }}>
          <View style={{ alignItems: "center", gap: 6 }}>
            <GraduationCap size={36} color={colors.primary} />
            <Text variant="title" style={{ textAlign: "center" }}>
              {displayName ? `Welcome, ${displayName}` : "Join your school"}
            </Text>
          </View>

          {domainCard}
          {otherWays}

          <JoinCodeForm />

          <Button variant="ghost" onPress={handleLogout}>
            Log out
          </Button>
        </View>
      </AuthShell>
    );
  }

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

        {domainCard}
        {otherWays}

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
                            disabled={
                              anyPending || joiningId !== null || domainJoining
                            }
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
