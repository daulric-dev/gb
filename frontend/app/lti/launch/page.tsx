"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleX, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  courseLtiApi,
  launchErrorMessage,
  safeLaunchUrl,
  type LtiLaunch,
} from "@/lib/lti";
import { Button } from "@/components/ui/button";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts an external tool (LTI) launch: the module item opens this in a new
 * tab, it asks the API for a single-use launch URL (the tool's login
 * initiation URL, valid five minutes) and replaces itself with it. Opening
 * the tab from the click itself, not after the request, keeps popup blockers
 * out of the way.
 */
function Launch() {
  const params = useSearchParams();
  const courseId = params?.get("course") ?? "";
  const itemId = params?.get("item") ?? "";
  const valid = UUID.test(courseId) && UUID.test(itemId);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!valid || started.current) return;
    started.current = true;
    api<LtiLaunch>(`${courseLtiApi(courseId)}/launches`, {
      method: "POST",
      body: { moduleItemId: itemId },
    })
      .then((r) => {
        const url = safeLaunchUrl(r.url);
        if (!url) throw new Error("bad launch url");
        window.location.replace(url);
      })
      .catch((err) => setError(launchErrorMessage(err)));
  }, [valid, courseId, itemId]);

  const shown = valid ? error : "This link is incomplete. Open the tool from the course again.";

  if (!shown) {
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Opening the tool…</p>
      </div>
    );
  }

  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <CircleX className="size-12 text-destructive" aria-hidden />
      <h1 className="text-xl font-semibold">The tool could not be opened</h1>
      <p role="alert" className="text-sm text-muted-foreground">
        {shown}
      </p>
      <Button variant="outline" className="mt-2" onClick={() => window.close()}>
        Close this tab
      </Button>
    </div>
  );
}

/** `/lti/launch?course=...&item=...`. */
export default function LtiLaunchPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Suspense
        fallback={<Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />}
      >
        <Launch />
      </Suspense>
    </main>
  );
}
