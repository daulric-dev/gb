"use client";

import { toast } from "sonner";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Ten one-time recovery codes, shown once, with copy and download. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Could not copy. Select the codes and copy them instead.");
    }
  }

  function download() {
    const blob = new Blob(
      [
        "GradeBook recovery codes\n",
        "Each code works once, instead of your authenticator app.\n\n",
        text,
        "\n",
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gradebook-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <ul translate="no"
        className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/50 p-4 font-mono text-sm"
        aria-label="Recovery codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Copy className="mr-1.5 size-4" />
          Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download className="mr-1.5 size-4" />
          Download
        </Button>
      </div>
    </div>
  );
}
