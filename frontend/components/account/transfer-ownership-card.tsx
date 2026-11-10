"use client";

import type { ReactNode } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Crown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { userMessage } from "@/lib/errors";

export interface TransferCandidate {
  userId: string;
  label: string;
}

/**
 * "Ownership" card shared by the organisation settings, the organisation's
 * page for one school and the school's own settings: who owns it, and (for
 * whoever may) a picker to hand it to someone else. The transfer asks the
 * user to confirm it's them (step-up) through `onTransfer`'s request.
 */
export function TransferOwnershipCard({
  id = "ownership",
  title,
  description,
  ownerLabel,
  candidates,
  canTransfer,
  emptyHint,
  confirmText,
  onTransfer,
}: {
  id?: string;
  title: string;
  description: ReactNode;
  ownerLabel: string | null;
  candidates: TransferCandidate[];
  canTransfer: boolean;
  /** Shown instead of the picker when nobody can take it. */
  emptyHint: ReactNode;
  /** The confirm() text for the chosen person. */
  confirmText: (candidate: TransferCandidate) => string;
  onTransfer: (userId: string) => Promise<void>;
}) {
  useSignals();
  const selected = useSignal("");
  const busy = useSignal(false);

  const chosen = candidates.find((c) => c.userId === selected.value) ?? null;

  async function transfer() {
    if (!chosen) return;
    if (!window.confirm(confirmText(chosen))) return;
    busy.value = true;
    try {
      await onTransfer(chosen.userId);
      selected.value = "";
    } catch (err) {
      toast.error(userMessage(err, "Failed to transfer ownership"));
    } finally {
      busy.value = false;
    }
  }

  return (
    <Card id={id} className="scroll-mt-24 space-y-4 p-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Owner:</span>
        {ownerLabel ? (
          <>
            <span className="truncate font-medium">{ownerLabel}</span>
            <Badge variant="secondary">
              <Crown className="mr-1 size-3" />
              Owner
            </Badge>
          </>
        ) : (
          <span className="text-muted-foreground">Nobody yet</span>
        )}
      </div>

      {canTransfer &&
        (candidates.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {emptyHint}
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor={`${id}-target`}>Transfer ownership to</Label>
              <NativeSelect
                id={`${id}-target`}
                className="w-full"
                value={selected.value}
                onChange={(e) => (selected.value = e.target.value)}
                disabled={busy.value}
              >
                <NativeSelectOption value="">Choose a person…</NativeSelectOption>
                {candidates.map((c) => (
                  <NativeSelectOption key={c.userId} value={c.userId}>
                    {c.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button
              variant="outline"
              onClick={() => void transfer()}
              disabled={!chosen || busy.value}
            >
              {busy.value && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Transfer ownership
            </Button>
          </div>
        ))}
    </Card>
  );
}
