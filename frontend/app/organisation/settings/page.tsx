"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage, type Organisation } from "@/lib/organisation";
import { useAuth } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgHeader } from "../_components/org-header";

export default function OrganisationSettingsPage() {
  const { refresh } = useAuth();
  const [org, setOrg] = useState<Organisation | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Organisation>("/organisation")
      .then((data) => {
        setOrg(data);
        setName(data?.name ?? "");
      })
      .catch((err) => toast.error(errorMessage(err, "Failed to load the organisation")));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) {
      toast.error("The organisation needs a name");
      return;
    }
    setSaving(true);
    try {
      const updated = await api<Organisation>("/organisation", {
        method: "PATCH",
        body: { name: value },
      });
      setOrg(updated && typeof updated === "object" ? updated : { ...org!, name: value });
      toast.success("Organisation renamed");
      // The name shows in the app chrome, which reads it from the profile.
      void refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to rename the organisation"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <OrgHeader title="Settings" description="Your organisation's details" />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Organisation name</CardTitle>
          <CardDescription>
            Shown to everyone on this install, alongside their school&apos;s name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!org ? (
            <Skeleton className="h-9" />
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Set up {new Date(org.createdAt).toLocaleDateString()}
                </p>
                <Button type="submit" disabled={saving || name.trim() === org.name}>
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
