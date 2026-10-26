"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleX, Loader2, TimerOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { storeScanClaim } from "@/lib/attendance-scan";
import { SCAN_PATH } from "@/lib/routing";
import { Button } from "@/components/ui/button";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type State =
  | { kind: "working" }
  | { kind: "error"; title: string; body: string; icon: typeof CircleX };

/**
 * Where the attendance QR on the teacher's screen lands.
 *
 * The phone camera opens this before we know whether anyone is signed in.
 * The QR token lives for seconds and signing in takes longer, so the token
 * is swapped for a five-minute, single-use claim straight away, kept for this tab, and the
 * student is sent on to the portal scan page - through sign-in if needed -
 * which checks them in with it.
 */
function ScanLanding() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params?.get("s") ?? "";
  const token = params?.get("t") ?? "";
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  const valid = UUID.test(sessionId) && !!token;

  useEffect(() => {
    if (!valid || started.current) return;
    started.current = true;

    api<{ claim: string; expiresAt: string }>("/attendance/scan-claim", {
      method: "POST",
      body: { sessionId, qrToken: token },
      skipAuthRedirect: true,
    })
      .then(({ claim }) => {
        storeScanClaim(sessionId, claim);
        router.replace(`${SCAN_PATH}?s=${encodeURIComponent(sessionId)}`);
      })
      .catch((err) => {
        const closed = err instanceof ApiError && /closed/i.test(err.message);
        setState({
          kind: "error",
          icon: closed ? CircleX : TimerOff,
          title: closed ? "Attendance has closed" : "That code has expired",
          body: closed
            ? "Ask your teacher if you still need to be marked in."
            : "The code changes every few seconds. Scan the one on screen again.",
        });
      });
  }, [valid, sessionId, token, router]);

  const shown: State = valid
    ? state
    : {
        kind: "error",
        icon: CircleX,
        title: "This link is incomplete",
        body: "Scan the code on your teacher's screen again.",
      };

  if (shown.kind === "working") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="size-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking the code…</p>
      </div>
    );
  }

  const Icon = shown.icon;
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <Icon className="size-12 text-destructive" />
      <h1 className="text-xl font-semibold">{shown.title}</h1>
      <p className="text-sm text-muted-foreground">{shown.body}</p>
      <Button render={<Link href="/portal" />} variant="outline" className="mt-2">
        Go to your portal
      </Button>
    </div>
  );
}

export default function ScanPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Suspense
        fallback={<Loader2 className="size-10 animate-spin text-muted-foreground" />}
      >
        <ScanLanding />
      </Suspense>
    </main>
  );
}
