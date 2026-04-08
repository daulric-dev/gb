"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
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
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [loading, setLoading] = useState(false);

  const [schools, setSchools] = useState<School[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    api<School[]>("/schools")
      .then((data) => {
        setSchools(data);
        if (data.length > 0) setSchoolId(data[0].id);
      })
      .catch(() => toast.error("Failed to load schools"))
      .finally(() => setSchoolsLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolId) {
      toast.error("Please select a school");
      return;
    }
    setLoading(true);

    try {
      await api("/auth/onboard", {
        method: "PATCH",
        body: { firstName, lastName, schoolId },
      });
      toast.success("Welcome aboard!");
      router.push("/dashboard");
    } catch (err) {
      console.error(err);
      const message = err instanceof ApiError ? err.message : "Onboarding Failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function handleSchoolCreated(school: School) {
    setSchools((prev) => [...prev, school].sort((a, b) => a.name.localeCompare(b.name)));
    setSchoolId(school.id);
    setCreateDialogOpen(false);
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
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="school">School</Label>
                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
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
              {schoolsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : schools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No schools found. Create one using the button above.
                </p>
              ) : (
                <select
                  id="school"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={schoolId}
                  onChange={(e) => setSchoolId(e.target.value)}
                  required
                >
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.parish ? ` — ${s.parish}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !schoolId}
            >
              {loading ? "Saving..." : "Get started"}
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
  const [name, setName] = useState("");
  const [schoolType, setSchoolType] = useState<"primary" | "secondary">(
    "secondary",
  );
  const [parish, setParish] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const school = await api<School>("/schools", {
        method: "POST",
        body: {
          name,
          schoolType,
          parish: parish || undefined,
        },
      });
      onSuccess(school);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="schoolName">School Name</Label>
        <Input
          id="schoolName"
          placeholder="St. Andrew Anglican Secondary"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="schoolType">Type</Label>
        <select
          id="schoolType"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={schoolType}
          onChange={(e) =>
            setSchoolType(e.target.value as "primary" | "secondary")
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
          value={parish}
          onChange={(e) => setParish(e.target.value)}
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
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating..." : "Create School"}
      </Button>
    </form>
  );
}
