import { Sparkles } from "lucide-react";
import { AI_DRAFT_LABEL } from "@/lib/ai";
import { cn } from "@/lib/utils";

/** The label every AI draft carries: what it is and that it needs review. */
export function AiDraftNote({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
        className,
      )}
    >
      <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-medium">{AI_DRAFT_LABEL}.</strong> {children}
      </span>
    </p>
  );
}
