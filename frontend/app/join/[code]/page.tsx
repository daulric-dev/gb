"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CircleX, KeyRound, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { normaliseJoinCode } from "@/lib/course-join";
import type { PortalCourseCard } from "@/lib/courses/types";
import { homePathFor, isStudentProfile, loginPath } from "@/lib/routing";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "working" }
  | {
      kind: "error";
      title: string;
      body: string;
      href: string;
      action: string;
    };

/**
 * Where a course join QR lands: `/join/<code>`.
 *
 * Signed-out visitors are sent through sign-in first and come back here (the
 * proxy keeps the path in `next`). A signed-in student is enrolled with the
 * code straight away and taken to the course. The code is checked by the API
 * each time, so a QR stops working the moment the teacher disables or
 * regenerates the code.
 */
export default function JoinCoursePage() {
  useSignals();
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { profile: profileSignal, loading: loadingSignal } = useProfile();
  const profile = profileSignal.value;
  const loading = loadingSignal.value;
  const [apiError, setApiError] = useState<State | null>(null);
  const started = useRef(false);

  const code = normaliseJoinCode(params?.code);

  // Anything that rules the join out before calling the API.
  let blocked: State | null = null;
  if (!loading) {
    if (!code) {
      blocked = {
        kind: "error",
        title: "That isn't a join code",
        body: "Check the code with your teacher, or scan the QR again.",
        href: homePathFor(profile),
        action: "Go to GradeBook",
      };
    } else if (profile && !isStudentProfile(profile)) {
      blocked = {
        kind: "error",
        title: "Join codes are for students",
        body: "This code enrols students in a course. Staff are added from the course's People page.",
        href: homePathFor(profile),
        action: "Back to the dashboard",
      };
    } else if (profile && (!profile.first_name || !profile.school)) {
      blocked = {
        kind: "error",
        title: "Finish setting up your account",
        body: "Join your school first, then scan the course code again.",
        href: homePathFor(profile),
        action: "Continue setup",
      };
    }
  }
  const ready = !loading && !blocked && !!code && !!profile;

  useEffect(() => {
    if (!ready || started.current || !code) return;
    started.current = true;
    api<PortalCourseCard>("/portal/me/courses/join", {
      method: "POST",
      body: { joinCode: code },
    })
      .then((course) => router.replace(`/portal/courses/${course.id}`))
      .catch((err) => {
        const notFound = err instanceof ApiError && err.status === 404;
        setApiError({
          kind: "error",
          title: notFound
            ? "This join code doesn't work"
            : "Could not join the course",
          body: notFound
            ? "Your teacher may have turned self-enrolment off or issued a new code. Ask them for the current one."
            : err instanceof ApiError
              ? err.message
              : "Something went wrong. Try again in a moment.",
          href: "/portal/courses",
          action: "Go to my courses",
        });
      });
  }, [ready, code, router]);

  // The proxy sends signed-out visitors to sign-in already; this covers a
  // stale session cookie, coming back here afterwards.
  useEffect(() => {
    if (!loading && !profile && code)
      router.replace(loginPath(`/join/${code}`));
  }, [loading, profile, code, router]);

  const state: State = blocked ?? apiError ?? { kind: "working" };

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        {state.kind === "working" ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <p className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4" />
              Joining the course{code ? ` with code ${code}` : ""}…
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <CircleX className="size-10 text-destructive" />
            <h1 className="text-lg font-semibold">{state.title}</h1>
            <p className="text-sm text-muted-foreground">{state.body}</p>
            <Button
              className="mt-2"
              nativeButton={false}
              render={<Link href={state.href} />}
            >
              {state.action}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
