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
import { ModeToggle } from "@/components/mode-toggle";
import { Plus } from "lucide-react";

interface School {
  id: string;
  name: string;
  parish: string | null;
  school_type: string | null;
}

export default function OnboardPage() {
  useSignals();
  const router = useRouter();
  const firstName = useSignal("");
  const lastName = useSignal("");
  const schoolId = useSignal("");
  const loading = useSignal(false);

  const schools = useSignal<School[]>([]);
  const schoolsLoading = useSignal(true);
  const createDialogOpen = useSignal(false);

  useEffect(() => {
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
    if (!schoolId.value) {
      toast.error("Please select a school");
      return;
    }
    loading.value = true;

    try {
      await api("/auth/onboard", {
        method: "PATCH",
        body: { firstName: firstName.value, lastName: lastName.value, schoolId: schoolId.value },
      });
      toast.success("Welcome aboard!");
      router.push("/dashboard");
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
    createDialogOpen.value = false;
    toast.success("School created");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 bg-background">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Complete your profile</CardTitle>
          <CardDescription>
            Tell us a bit about yourself to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="school">School</Label>
                <Dialog open={createDialogOpen.value} onOpenChange={(v) => (createDialogOpen.value = v)}>
                  <DialogTrigger
                    render={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                    <CreateSchoolForm onSuccess={handleSchoolCreated} />
                  </DialogContent>
                </Dialog>
              </div>
              {schoolsLoading.value ? (
                <Skeleton className="h-9 w-full" />
              ) : schools.value.length === 0 ? (
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
                  {schools.value.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.parish ? ` - ${s.parish}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading.value || !schoolId.value}
            >
              {loading.value ? "Saving..." : "Get started"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
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
