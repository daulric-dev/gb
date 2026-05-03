"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useProfile } from "@/lib/use-profile";
import { useSignal, useComputed } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { GraduationCap, Loader2, LogOut, Plus, Search } from "lucide-react";
import { clearAccessToken } from "@/lib/auth";

const isDedicated = process.env.NEXT_PUBLIC_DEDICATED_DEPLOYMENT === "true";

interface School {
  id: string;
  name: string;
  parish: string | null;
  school_type: string | null;
}

function CreateSchoolForm({ onSuccess }: { onSuccess: (school: School) => void }) {
  useSignals();

  const name = useSignal("");
  const schoolType = useSignal<"primary" | "secondary">("secondary");
  const parish = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;
    try {
      const school = await api<School>("/schools", {
        method: "POST",
        body: {
          name: name.value,
          schoolType: schoolType.value,
          parish: parish.value || undefined,
        },
      });
      onSuccess(school);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create school";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="schoolName">School Name</Label>
        <Input
          id="schoolName"
          placeholder="St. Andrew Anglican Secondary"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="schoolType">Type</Label>
        <select
          id="schoolType"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={schoolType.value}
          onChange={(e) => (schoolType.value = e.target.value as "primary" | "secondary")}
        >
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="parish">Parish</Label>
        <select
          id="parish"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={parish.value}
          onChange={(e) => (parish.value = e.target.value)}
          required
        >
          <option value="">Select a parish</option>
          <option value="St. Andrew">St. Andrew</option>
          <option value="St. David">St. David</option>
          <option value="St. George">St. George</option>
          <option value="St. John">St. John</option>
          <option value="St. Mark">St. Mark</option>
          <option value="St. Patrick">St. Patrick</option>
          <option value="Carriacou and Petite Martinique">Carriacou and Petite Martinique</option>
        </select>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Create School"}
      </Button>
    </form>
  );
}

export default function SchoolsPage() {
  useSignals();

  const router = useRouter();
  const { profile, loading: profileLoading } = useProfile();
  const schools = useSignal<School[]>([]);
  const loading = useSignal(true);
  const joiningId = useSignal<string | null>(null);
  const pendingSchoolId = useSignal<string | null>(null);
  const search = useSignal("");
  const createOpen = useSignal(false);

  const filtered = useComputed(() => {
    const q = search.value.toLowerCase();
    if (!q) return schools.value;
    return schools.value.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.parish?.toLowerCase().includes(q),
    );
  });

  useEffect(() => {
    if (!profileLoading.value && profile.value?.school) {
      router.replace("/dashboard");
    }
  }, [profileLoading.value, profile.value?.school, router]);

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
  }, []);

  async function handleJoin(school: School) {
    joiningId.value = school.id;
    try {
      const result = await api<{ autoJoined?: boolean }>(
        `/schools/${school.id}/join-requests`,
        { method: "POST" },
      );
      if (result?.autoJoined) {
        toast.success(`You've joined ${school.name}!`);
        window.location.href = "/dashboard";
      } else {
        pendingSchoolId.value = school.id;
        joiningId.value = null;
        toast.success(
          `Join request sent for ${school.name} — waiting for admin approval.`,
        );
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to submit join request";
      toast.error(message);
      joiningId.value = null;
    }
  }

  function handleSchoolCreated(school: School) {
    createOpen.value = false;
    toast.success(`${school.name} created! You're now the admin.`);
    window.location.href = "/dashboard";
  }

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    clearAccessToken();
    router.push("/login");
  }

  const displayName = profile.value?.first_name
    ? `${profile.value.first_name} ${profile.value.last_name ?? ""}`.trim()
    : "";

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

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Schools</CardTitle>
                <CardDescription>Select a school to request access</CardDescription>
              </div>
              {!isDedicated && (
                <Dialog open={createOpen.value} onOpenChange={(v) => (createOpen.value = v)}>
                  <DialogTrigger render={<Button size="sm" variant="outline" />}>
                    <Plus className="mr-1.5 size-3.5" />
                    Create
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create a School</DialogTitle>
                      <DialogDescription>
                        Add a new school — you&apos;ll be assigned as its admin.
                      </DialogDescription>
                    </DialogHeader>
                    <CreateSchoolForm onSuccess={handleSchoolCreated} />
                  </DialogContent>
                </Dialog>
              )}
            </div>
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
