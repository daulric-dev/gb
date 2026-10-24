"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Eye, PenLine } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Write / Preview tabs over a Markdown textarea. */
export function MarkdownEditor({
  id,
  value,
  onChangeAction,
  rows = 14,
  placeholder,
}: {
  id?: string;
  value: string;
  onChangeAction: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  useSignals();
  const mode = useSignal<"write" | "preview">("write");

  const tab = (key: "write" | "preview", label: string, Icon: typeof Eye) => (
    <button
      type="button"
      onClick={() => (mode.value = key)}
      aria-pressed={mode.value === key}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        mode.value === key
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-2 py-1.5">
        <div className="flex gap-1 rounded-lg bg-muted p-0.5">
          {tab("write", "Write", PenLine)}
          {tab("preview", "Preview", Eye)}
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Markdown: **bold**, _italic_, # heading, - list, [link](url)
        </span>
      </div>
      {mode.value === "write" ? (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChangeAction(e.target.value)}
          className="rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0"
        />
      ) : (
        <div
          className="min-h-40 px-4 py-3"
          style={{ minHeight: `${rows * 1.5}rem` }}
        >
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      )}
    </div>
  );
}
