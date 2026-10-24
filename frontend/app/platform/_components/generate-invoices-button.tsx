"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FilePlus2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/billing";
import { Button } from "@/components/ui/button";

/** Runs the invoice sweep now instead of waiting for the daily run. */
export function GenerateInvoicesButton({ onDone }: { onDone?: () => void }) {
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const { created } = await api<{ created: number }>(
        "/platform/invoices/generate",
        { method: "POST" },
      );
      toast.success(
        created === 0
          ? "No invoices were due"
          : `Created ${created} invoice${created === 1 ? "" : "s"}`,
      );
      onDone?.();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to generate invoices"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button onClick={run} disabled={running} variant="outline">
      {running ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <FilePlus2 className="mr-2 size-4" />
      )}
      Generate invoices now
    </Button>
  );
}
