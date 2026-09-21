"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";

interface SchoolCodeStatus {
  activeCode: { expiresAt: string; issuedAt: string | null } | null;
  expired: boolean;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The school-wide join code. Students enter it on the sign-in side to create
 * their own record and join, so no one has to add them to the roster first.
 */
export function SchoolJoinCodeDialog({
  open,
  onOpenChangeAction,
  canIssue,
}: {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  canIssue: boolean;
}) {
  useSignals();

  const status = useSignal<SchoolCodeStatus | null>(null);
  const loading = useSignal(true);
  const working = useSignal(false);
  const copied = useSignal(false);
  /** Shown exactly once after issuing; the server only stores a hash. */
  const issuedCode = useSignal<string | null>(null);

  const load = useCallback(() => {
    loading.value = true;
    api<SchoolCodeStatus>("/schools/join-code")
      .then((data) => (status.value = data))
      .catch(() => (status.value = null))
      .finally(() => (loading.value = false));
  }, [loading, status]);

  useEffect(() => {
    if (!open) return;
    issuedCode.value = null;
    copied.value = false;
    load();
  }, [open, load, issuedCode, copied]);

  async function issue() {
    working.value = true;
    try {
      const result = await api<{ code: string; expiresAt: string }>(
        "/schools/join-code",
        { method: "POST", body: {} },
      );
      issuedCode.value = result.code;
      load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to issue join code",
      );
    } finally {
      working.value = false;
    }
  }

  async function revoke() {
    working.value = true;
    try {
      await api("/schools/join-code", { method: "DELETE" });
      issuedCode.value = null;
      toast.success("Join code revoked");
      load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke join code",
      );
    } finally {
      working.value = false;
    }
  }

  async function copy() {
    if (!issuedCode.value) return;
    try {
      await navigator.clipboard.writeText(issuedCode.value);
      copied.value = true;
      setTimeout(() => (copied.value = false), 2000);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>School join code</DialogTitle>
          <DialogDescription>
            Students enter this code when they sign up to join your school. It
            works for anyone who has it, until it expires or you revoke it.
          </DialogDescription>
        </DialogHeader>

        {/* The issued code outranks the loading state: issuing refetches the
            status, and this is the only moment the code is visible. */}
        {issuedCode.value ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-4 text-center">
              <p className="font-mono text-2xl font-semibold tracking-widest">
                {issuedCode.value}
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              type="button"
              onClick={copy}
            >
              {copied.value ? (
                <>
                  <Check className="mr-2 size-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 size-4" />
                  Copy code
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Write this down now. Only a hash is stored, so it cannot be shown
              again - if it is lost, issue a new one.
            </p>
          </div>
        ) : loading.value ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              {status.value?.activeCode ? (
                <>
                  <p className="text-sm font-medium">A code is active</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {formatDate(status.value.activeCode.expiresAt)}.
                    Issuing a new code replaces it.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {status.value?.expired
                      ? "The previous code has expired"
                      : "No code has been issued"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Issue one and share it with your students.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={working.value}
          >
            Close
          </Button>
          {canIssue && (
            <div className="flex gap-2">
              {status.value?.activeCode && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={revoke}
                  disabled={working.value}
                >
                  Revoke
                </Button>
              )}
              <Button onClick={issue} disabled={working.value}>
                {working.value && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {status.value?.activeCode ? "Reissue code" : "Issue code"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
