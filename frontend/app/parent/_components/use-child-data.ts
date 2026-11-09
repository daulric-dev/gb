"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";

/**
 * Load one parent-portal resource for a child. `error` carries the API's
 * message (a hidden area, a turned-off feature) to show in place.
 */
export function useChildData<T>(path: string | null) {
  const data = useSignal<T | null>(null);
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    loading.value = true;
    error.value = null;
    api<T>(path)
      .then((d) => {
        if (!cancelled) data.value = d;
      })
      .catch((err) => {
        if (!cancelled) error.value = userMessage(err, "This could not be loaded");
      })
      .finally(() => {
        if (!cancelled) loading.value = false;
      });
    return () => {
      cancelled = true;
    };
  }, [path, data, loading, error]);

  return { data, loading, error };
}
