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
import { Check, Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import type { Student } from "./types";

interface ClaimStatus {
  hasAccount: boolean;
  outstandingCode: { expiresAt: string; issuedAt: string | null } | null;
  expiredCode: boolean;
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

export function ClaimCodeDialog({
  student,
  onOpenChangeAction,
  onChangedAction,
}: {
  student: Student | null;
  onOpenChangeAction: (open: boolean) => void;
  onChangedAction?: () => void;
}) {
  useSignals();

  const status = useSignal<ClaimStatus | null>(null);
  const loading = useSignal(true);
  const working = useSignal(false);
  const copied = useSignal(false);
  /** Shown exactly once after issuing; the server only stores a hash. */
  const issuedCode = useSignal<string | null>(null);

  const studentId = student?.id;

  const load = useCallback(
    (id: string) => {
      loading.value = true;
      api<ClaimStatus>(`/students/${id}/claim-code`)
        .then((data) => (status.value = data))
        .catch(() => (status.value = null))
        .finally(() => (loading.value = false));
    },
    [loading, status],
  );

  useEffect(() => {
    if (!studentId) return;
    issuedCode.value = null;
    copied.value = false;
    load(studentId);
  }, [studentId, load, issuedCode, copied]);

  async function issue() {
    if (!studentId) return;
    working.value = true;
    try {
      const result = await api<{ code: string; expiresAt: string }>(
        `/students/${studentId}/claim-code`,
        { method: "POST", body: {} },
      );
      issuedCode.value = result.code;
      load(studentId);
      onChangedAction?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to issue claim code",
      );
    } finally {
      working.value = false;
    }
  }

  async function revoke() {
    if (!studentId) return;
    working.value = true;
    try {
      await api(`/students/${studentId}/claim-code`, { method: "DELETE" });
      issuedCode.value = null;
      toast.success("Claim code revoked");
      load(studentId);
      onChangedAction?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke claim code",
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

  const name = student
    ? `${student.first_name} ${student.last_name}`.trim()
    : "this student";

  return (
    <Dialog open={student !== null} onOpenChange={onOpenChangeAction}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Student account</DialogTitle>
          <DialogDescription>
            A claim code lets {name} create a login linked to this record.
          </DialogDescription>
        </DialogHeader>

        {loading.value ? (
          <Skeleton className="h-24 w-full" />
        ) : issuedCode.value ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-4 text-center">
              <p className="font-mono text-2xl font-semibold tracking-widest">
                {issuedCode.value}
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={copy}
              type="button"
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
        ) : status.value?.hasAccount ? (
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">This student has an account</p>
              <p className="text-xs text-muted-foreground">
                No further code is needed.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              {status.value?.outstandingCode ? (
                <>
                  <p className="text-sm font-medium">A code is outstanding</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {formatDate(status.value.outstandingCode.expiresAt)}.
                    Issuing a new code replaces it.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {status.value?.expiredCode
                      ? "The previous code has expired"
                      : "No code has been issued"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Issue one and give it to the student.
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
          {!status.value?.hasAccount && (
            <div className="flex gap-2">
              {status.value?.outstandingCode && (
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
                {status.value?.outstandingCode ? "Reissue code" : "Issue code"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
