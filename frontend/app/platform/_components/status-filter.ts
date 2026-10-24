import { useState } from "react";

/**
 * `?status=` from the URL (the overview tiles link with it). Platform pages
 * only render client-side, after the layout has confirmed the operator, so
 * reading `window` in the initializer is safe.
 */
export function useInitialStatusParam(): [string, (v: string) => void] {
  return useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("status") ?? ""),
  );
}
