"use client";

import { ErrorFallback } from "@/components/layout/error-fallback";

/** Error boundary for this segment: a friendly message, never `error.message`. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} />;
}
