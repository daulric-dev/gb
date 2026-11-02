"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { homePathFor, isStudentProfile, ORGANISATION_PATH } from "@/lib/routing";
import { useSetupGate } from "@/lib/setup";
import Link from "next/link";
import type { DomainJoinResult, DomainMatch } from "@/lib/email-domains";
import { JoinCodeForm } from "@/components/auth/join-code-form";
import { useSignal, useComputed } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import {
  AtSign,
  Building2,
  GraduationCap,
  Loader2,
  LogOut,
  Search,
} from "lucide-react";
import { userMessage } from "@/lib/errors";

interface School {
  id: string;
  name: string;
  parish: string | null;
  school_type: string | null;
}

/**
 * "Your @domain address belongs to <school>" - offered when a school has
 * verified the domain of the signed-in address.
 */
function DomainMatchCard({
  match,
  joining,
  pending,
  onJoin,
}: {
  match: DomainMatch;
  joining: boolean;
  pending: boolean;
  onJoin: () => void;
}) {
  // Students always join outright; staff do only when the school allows it.
  const joinsOutright = match.audience === "student" || match.autoJoin;
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <AtSign className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="space-y-1">
            <CardTitle className="text-lg">
              Your @{match.domain} address belongs to {match.schoolName}
            </CardTitle>
            <CardDescription>
              {pending
                ? `Your request to join ${match.schoolName} is waiting for an admin to approve it.`
                : joinsOutright
                  ? `You can join ${match.schoolName} right away.`
                  : `An admin at ${match.schoolName} will approve your request.`}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {pending ? (
          <Button className="w-full" variant="outline" disabled>
            Request pending
          </Button>
        ) : (
          <Button className="w-full" onClick={onJoin} disabled={joining}>
            {joining && <Loader2 className="mr-2 size-4 animate-spin" />}
            {joinsOutright ? `Join ${match.schoolName}` : "Ask to join"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const NO_SELF_CREATE =
  "Schools are added by your organisation's administrators. Ask your school for a join code, or ask an administrator to add you.";

/** How often a waiting applicant re-checks whether they have been approved. */
const POLL_MS = 8000;

export default function SchoolsPage() {
  useSignals();

  const router = useRouter();
  const { profile, loading: profileLoading, refresh } = useAuth();
  const schools = useSignal<School[]>([]);
  const loading = useSignal(true);
  const joiningId = useSignal<string | null>(null);
  const pendingSchoolId = useSignal<string | null>(null);
  const search = useSignal("");
  const domainMatch = useSignal<DomainMatch | null>(null);
  const domainJoining = useSignal(false);

  const filtered = useComputed(() => {
    const q = search.value.toLowerCase();
    if (!q) return schools.value;
    return schools.value.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.parish?.toLowerCase().includes(q),
    );
  });

  const settledProfile = profile.value;
  useSetupGate(!profileLoading.value && !!settledProfile);
  useEffect(() => {
    if (!profileLoading.value && settledProfile?.school) {
      router.replace(homePathFor(settledProfile));
    }
  }, [profileLoading.value, settledProfile, router]);

  // Approval happens on the admin's screen, not this one. Without polling, an
  // accepted student sits on "Pending" until they think to reload; the effect
  // above then redirects as soon as a school appears on the profile.
  useEffect(() => {
    if (!pendingSchoolId.value) return;
    if (profile.value?.school) return;

    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingSchoolId.value, profile.value?.school, refresh]);

  useEffect(() => {
    Promise.all([
      api<School[]>("/schools"),
      api<{ school_id: string } | null>("/schools/my-pending-request").catch(() => null),
    ])
      .then(([schoolList, pending]) => {
        schools.value = schoolList;
        if (pending?.school_id) {
          pendingSchoolId.value = pending.school_id;
        }
      })
      .catch(() => toast.error("Failed to load schools"))
      .finally(() => (loading.value = false));
  }, [loading, pendingSchoolId, schools]);

  // A school that verified this address's domain; purely a shortcut, so a
  // failure just leaves the usual options.
  useEffect(() => {
    api<{ match: DomainMatch | null }>("/auth/email-domain/match")
      .then((res) => (domainMatch.value = res?.match ?? null))
      .catch(() => (domainMatch.value = null));
  }, [domainMatch]);

  async function handleDomainJoin() {
    const match = domainMatch.value;
    if (!match) return;
    domainJoining.value = true;
    try {
      const result = await api<DomainJoinResult>("/auth/email-domain/join", {
        method: "POST",
      });
      if (result.status === "joined") {
        toast.success(`You've joined ${match.schoolName}!`);
        await refresh();
        router.push(homePathFor(profile.value));
        return;
      }
      pendingSchoolId.value = result.schoolId;
      toast.success(
        `Join request sent for ${match.schoolName} - waiting for admin approval.`,
      );
    } catch (err) {
      toast.error(userMessage(err, "Failed to join the school"));
    } finally {
      domainJoining.value = false;
    }
  }

  const matchCard = domainMatch.value ? (
    <DomainMatchCard
      match={domainMatch.value}
      joining={domainJoining.value}
      pending={pendingSchoolId.value === domainMatch.value.schoolId}
      onJoin={handleDomainJoin}
    />
  ) : null;

  const otherWaysHeading = matchCard ? (
    <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
      Or join another way
    </p>
  ) : null;

  async function handleJoin(school: School) {
    joiningId.value = school.id;
    try {
      const result = await api<{ autoJoined?: boolean }>(
        `/schools/${school.id}/join-requests`,
        { method: "POST" },
      );
      if (result?.autoJoined) {
        toast.success(`You've joined ${school.name}!`);
        router.push("/dashboard")
      } else {
        pendingSchoolId.value = school.id;
        joiningId.value = null;
        toast.success(
          `Join request sent for ${school.name} - waiting for admin approval.`,
        );
      }
    } catch (err) {
      const message = userMessage(err, "Failed to submit join request");
      toast.error(message);
      joiningId.value = null;
    }
  }

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    router.push("/login");
  }

  const displayName = profile.value?.first_name
    ? `${profile.value.first_name} ${profile.value.last_name ?? ""}`.trim()
    : "";

  // A student joins by redeeming the code their school issued, so they get the
  // code field alone - no school list.
  if (isStudentProfile(profile.value)) {
    return (
      <AuthPageShell>
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center">
            <GraduationCap className="mx-auto size-10 text-primary" />
            <h1 className="text-2xl font-bold">
              {displayName ? `Welcome, ${displayName}` : "Join your school"}
            </h1>
          </div>

          {matchCard}
          {otherWaysHeading}

          <JoinCodeForm />

          <p className="text-center text-sm text-muted-foreground">
            {NO_SELF_CREATE}
          </p>

          <button
            type="button"
            onClick={handleLogout}
            className="mx-auto flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <GraduationCap className="mx-auto size-10 text-primary" />
          <h1 className="text-2xl font-bold">
            {displayName ? `Welcome, ${displayName}` : "Choose a School"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse the available schools and request to join one.
          </p>
        </div>

        {profile.value?.is_org_admin && (
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link href={ORGANISATION_PATH} />}
          >
            <Building2 className="mr-2 size-4" />
            Manage your organisation
          </Button>
        )}

        {matchCard}
        {otherWaysHeading}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Schools</CardTitle>
            <CardDescription>Select a school to request access</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!loading.value && schools.value.length > 5 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search schools..."
                  value={search.value}
                  onChange={(e) => (search.value = e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent py-2 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            )}

            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {loading.value ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))
              ) : filtered.value.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {schools.value.length === 0
                    ? "No schools available."
                    : "No schools match your search."}
                </p>
              ) : (
                filtered.value.map((school) => {
                  const isJoining = joiningId.value === school.id;
                  const isPending = pendingSchoolId.value === school.id;
                  const disabled = joiningId.value !== null || pendingSchoolId.value !== null;
                  return (
                    <div
                      key={school.id}
                      className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
                    >
                      <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{school.name}</p>
                        {school.parish && (
                          <p className="text-xs text-muted-foreground truncate">
                            {school.parish}
                          </p>
                        )}
                      </div>
                      {isPending ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          Pending
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => handleJoin(school)}
                        >
                          {isJoining ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            "Request"
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          {NO_SELF_CREATE}
        </p>

        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-2 size-3.5" />
            Log out
          </Button>
        </div>
      </div>
    </AuthPageShell>
  );
}
