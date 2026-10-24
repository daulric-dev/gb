"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Ban, Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Students with an account can join the course themselves with this code from
 * the portal. Regenerating invalidates the old code; disabling stops joins.
 */
export function JoinCodeCard({
  courseId,
  joinCode,
  canManage,
  onChangedAction,
}: {
  courseId: string;
  joinCode: string | null;
  canManage: boolean;
  onChangedAction: () => void;
}) {
  useSignals();
  const working = useSignal(false);

  async function regenerate() {
    working.value = true;
    try {
      await api<{ joinCode: string }>(`/courses/${courseId}/join-code`, {
        method: "POST",
        body: {},
      });
      toast.success(joinCode ? "New code generated" : "Join code enabled");
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to generate");
    } finally {
      working.value = false;
    }
  }

  async function disable() {
    working.value = true;
    try {
      await api(`/courses/${courseId}/join-code`, { method: "DELETE" });
      toast.success("Join code disabled");
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to disable");
    } finally {
      working.value = false;
    }
  }

  async function copy() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Join code</p>
          <p className="text-xs text-muted-foreground">
            {joinCode
              ? "Students enter this in the portal to enrol themselves."
              : "Self-enrolment is off. Enable a code to let students join."}
          </p>
        </div>
        {joinCode && (
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 font-mono text-lg font-semibold tracking-widest hover:bg-muted"
            title="Copy"
          >
            {joinCode}
            <Copy className="size-3.5 text-muted-foreground" />
          </button>
        )}
        {canManage && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={regenerate}
              disabled={working.value}
            >
              {working.value ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-3.5" />
              )}
              {joinCode ? "Regenerate" : "Enable"}
            </Button>
            {joinCode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={disable}
                disabled={working.value}
              >
                <Ban className="mr-1.5 size-3.5" />
                Disable
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
