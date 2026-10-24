"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A labelled read-only value with a copy button. */
export function CopyRow({ label, value, note }: { label: string; value: string; note?: string }) {
  useSignals();
  const copied = useSignal(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    } catch {
      toast.error("Couldn't copy - select the text and copy it instead");
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={copy}
          aria-label={`Copy ${label}`}
          title="Copy"
        >
          {copied.value ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
