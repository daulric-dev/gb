"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { EmailDomain } from "@/lib/email-domains";
import { Button } from "@/components/ui/button";
import { CopyRow } from "./CopyRow";

/** DNS instructions for an unverified domain, plus the "Check now" action. */
export function VerifyPanel({
  domain,
  onVerifiedAction,
}: {
  domain: EmailDomain;
  onVerifiedAction: (domain: EmailDomain) => void;
}) {
  useSignals();
  const checking = useSignal(false);
  const error = useSignal<string | null>(null);

  async function check() {
    checking.value = true;
    error.value = null;
    try {
      const updated = await api<EmailDomain>(
        `/schools/email-domains/${domain.id}/verify`,
        { method: "POST" },
      );
      toast.success(`${updated.domain} verified`);
      onVerifiedAction(updated);
    } catch (err) {
      error.value =
        err instanceof ApiError ? err.message : "Failed to verify the domain";
    } finally {
      checking.value = false;
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Prove your school owns {domain.domain}</p>
        <p className="text-xs text-muted-foreground">
          Add this record wherever the domain&apos;s DNS is managed, then check
          it here. Until it is verified, nobody joins through this domain.
        </p>
      </div>

      <div className="grid gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Type</p>
          <code className="inline-block rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs">
            {domain.dnsRecord.type}
          </code>
        </div>
        <CopyRow
          label="Name / Host"
          value={domain.dnsRecord.name}
          note={'Some DNS hosts want "@" here instead of the full domain.'}
        />
        <CopyRow label="Value" value={domain.dnsRecord.value} />
      </div>

      {error.value && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {error.value}
        </p>
      )}

      <Button type="button" size="sm" onClick={check} disabled={checking.value}>
        {checking.value ? (
          <Loader2 className="mr-2 size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 size-3.5" />
        )}
        Check now
      </Button>
    </div>
  );
}
