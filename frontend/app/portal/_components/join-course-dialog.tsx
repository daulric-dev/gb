"use client";

import { useRouter } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PortalCourseCard } from "@/lib/courses/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function JoinCourseDialog({
  onJoined,
  variant = "default",
}: {
  onJoined?: (course: PortalCourseCard) => void;
  variant?: "default" | "outline";
}) {
  useSignals();

  const router = useRouter();
  const open = useSignal(false);
  const code = useSignal("");
  const joining = useSignal(false);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const joinCode = code.value.trim();
    if (!joinCode) {
      toast.error("Enter the code your teacher gave you");
      return;
    }

    joining.value = true;
    try {
      const course = await api<PortalCourseCard>("/portal/me/courses/join", {
        method: "POST",
        body: { joinCode },
      });
      toast.success(`Joined ${course.name}`);
      open.value = false;
      code.value = "";
      onJoined?.(course);
      router.push(`/portal/courses/${course.id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not join that course",
      );
    } finally {
      joining.value = false;
    }
  }

  return (
    <Dialog open={open.value} onOpenChange={(v) => (open.value = v)}>
      <DialogTrigger render={<Button variant={variant} />}>
        <Plus className="mr-2 size-4" />
        Join a course
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={join} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Join a course</DialogTitle>
            <DialogDescription>
              Enter the join code your teacher shared with the class.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="join-code">Join code</Label>
            <Input
              id="join-code"
              autoFocus
              autoComplete="off"
              placeholder="e.g. 7KQ2MX"
              className="font-mono tracking-widest uppercase"
              value={code.value}
              onChange={(e) => (code.value = e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={joining.value}>
              {joining.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Join
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
