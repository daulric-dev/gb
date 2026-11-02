"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errors";

/** The server-log hash Next attaches to an error, if any; never its message. */
export function errorDigest(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^[\w-]{1,64}$/.test(digest) ? digest : null;
}

/**
 * The body of every route error boundary (`app/**\/error.tsx`). Shows a fixed,
 * friendly message and a "Try again" button; the error itself only goes to
 * the console, with `error.digest` as a reference for the server logs.
 */
export function ErrorFallback({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = errorDigest(error);
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>This page could not be loaded</EmptyTitle>
          <EmptyDescription>
            {GENERIC_ERROR_MESSAGE}
            {digest && <span className="mt-1 block text-xs">Reference: {digest}</span>}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => retry()}>Try again</Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
