"use client";

import { useEffect } from "react";
import { errorDigest } from "@/components/layout/error-fallback";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errors";

/**
 * Replaces the root layout when it fails, so it brings its own document and
 * styles (globals.css is not loaded here). Shows a fixed message; the error
 * goes to the console, with `error.digest` as the server-log reference.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = errorDigest(error);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <title>GradeBook</title>
        <main style={{ maxWidth: 420, padding: 16, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>GradeBook could not be loaded</h1>
          <p style={{ opacity: 0.8 }}>{GENERIC_ERROR_MESSAGE}</p>
          {digest && <p style={{ fontSize: 12, opacity: 0.6 }}>Reference: {digest}</p>}
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 12, padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
