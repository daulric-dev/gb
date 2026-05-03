"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
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
import { Plus } from "lucide-react";

interface School {
  id: string;
  name: string;
  parish: string | null;
  school_type: string | null;
}

function OnboardProfileCard({
  firstName,
  lastName,
  schoolId,
  loading,
  schools,
  schoolsLoading,
  createDialogOpen,
  onSubmit,
  onSchoolCreated,
}: {
  firstName: ReturnType<typeof useSignal<string>>;
  lastName: ReturnType<typeof useSignal<string>>;
  schoolId: ReturnType<typeof useSignal<string>>;
  loading: ReturnType<typeof useSignal<boolean>>;
  schools: ReturnType<typeof useSignal<School[]>>;
  schoolsLoading: ReturnType<typeof useSignal<boolean>>;
  createDialogOpen: ReturnType<typeof useSignal<boolean>>;
  onSubmit: (e: React.FormEvent) => void;
  onSchoolCreated: (school: School) => void;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Complete your profile</CardTitle>
        <CardDescription>
          Tell us a bit about yourself to get started
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                placeholder="John"
                value={firstName.value}
                onChange={(e) => (firstName.value = e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                placeholder="Doe"
                value={lastName.value}
                onChange={(e) => (lastName.value = e.target.value)}
                required
              />
            </div>
          </div>
          {!isDedicated && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="school">School</Label>
                <Dialog open={createDialogOpen.value} onOpenChange={(v) => (createDialogOpen.value = v)}>
                  <DialogTrigger
                    render={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      />
                    }
                  >
                    <Plus className="size-3" />
                    Create school
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create a School</DialogTitle>
                      <DialogDescription>
                        Add a new school to the system
                      </DialogDescription>
                    </DialogHeader>
                    <CreateSchoolForm onSuccess={onSchoolCreated} />
                  </DialogContent>
                </Dialog>
              </div>
              {schoolsLoading.value ? (
                <Skeleton className="h-9 w-full" />
              ) : (schools.value ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No schools found. Create one using the button above.
                </p>
              ) : (
                <select
                  id="school"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={schoolId.value}
                  onChange={(e) => (schoolId.value = e.target.value)}
                  required
                >
                  {(schools.value ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.parish ? ` - ${s.parish}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={loading.value || (!isDedicated && !schoolId.value)}
          >
            {loading.value ? "Saving..." : "Get started"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const isDedicated = process.env.NEXT_PUBLIC_DEDICATED_DEPLOYMENT === 'true';

export default function OnboardPage() {
  useSignals();
  const router = useRouter();
  const firstName = useSignal("");
  const lastName = useSignal("");
  const schoolId = useSignal("");
  const loading = useSignal(false);

  const schools = useSignal<School[]>([]);
  const schoolsLoading = useSignal(!isDedicated);
  const createDialogOpen = useSignal(false);
  // Tracks whether the currently selected school was just created by this user
  const schoolWasCreated = useSignal(false);

  useEffect(() => {
    if (isDedicated) return;
    api<School[]>("/schools")
      .then((data) => {
        schools.value = data;
        if (data.length > 0) schoolId.value = data[0].id;
      })
      .catch(() => toast.error("Failed to load schools"))
      .finally(() => (schoolsLoading.value = false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isDedicated && !schoolId.value) {
      toast.error("Please select a school");
      return;
    }
    loading.value = true;

    try {
      const body: Record<string, string> = {
        firstName: firstName.value,
        lastName: lastName.value,
      };
      if (!isDedicated) body.schoolId = schoolId.value;

      const result = await api<any>("/auth/onboard", { method: "PATCH", body });

      if (result?.joinRequest) {
        // User is joining an existing school — redirect to pending page
        const selectedSchool = schools.value.find((s) => s.id === schoolId.value);
        const schoolName = selectedSchool?.name ?? "";
        router.push(`/onboard/pending?school=${encodeURIComponent(schoolName)}`);
      } else {
        toast.success("Welcome aboard!");
        router.push("/dashboard");
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof ApiError ? err.message : "Onboarding Failed";
      toast.error(message);
    } finally {
      loading.value = false;
    }
  }

  function handleSchoolCreated(school: School) {
    schools.value = [...schools.value, school].sort((a, b) => a.name.localeCompare(b.name));
    schoolId.value = school.id;
    schoolWasCreated.value = true;
    createDialogOpen.value = false;
    toast.success("School created");
  }

  return (
    <AuthPageShell>
      <OnboardProfileCard
        firstName={firstName}
        lastName={lastName}
        schoolId={schoolId}
        loading={loading}
        schools={schools}
        schoolsLoading={schoolsLoading}
        createDialogOpen={createDialogOpen}
        onSubmit={handleSubmit}
        onSchoolCreated={handleSchoolCreated}
      />
    </AuthPageShell>
  );
}

function CreateSchoolForm({
  onSuccess,
}: {
  onSuccess: (school: School) => void;
}) {
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
      const msg = err instanceof ApiError ? err.message : "Failed to create";
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
          onChange={(e) =>
            (schoolType.value = e.target.value as "primary" | "secondary")
          }
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
