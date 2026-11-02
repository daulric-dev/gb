"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { homePathFor } from "@/lib/routing";
import { useProfile } from "@/providers/AuthProvider";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { cn } from "@/lib/utils";

interface InstallStatus {
  needsSetup: boolean;
  organisation: { name: string } | null;
}

/**
 * The install's front door. A self-hosted GradeBook belongs to one
 * organisation, so this is its sign-in landing, not a product page: the
 * organisation's name and a way in. Signed-in users go straight to their
 * home; a fresh install invites the first person to sign in and set it up.
 */
export default function HomePage() {
  useSignals();
  const router = useRouter();
  const { profile, loading } = useProfile();
  const [status, setStatus] = useState<InstallStatus | null>(null);

  useEffect(() => {
    if (!loading.value && profile.value) {
      router.replace(homePathFor(profile.value));
    }
  }, [loading.value, profile.value, router]);

  useEffect(() => {
    let live = true;
    api<InstallStatus>("/setup/status", { skipAuthRedirect: true })
      .then((res) => {
        if (live) setStatus(res);
      })
      .catch(() => {
        // Unreachable API: still offer sign-in rather than a blank page.
        if (live) setStatus({ needsSetup: false, organisation: null });
      });
    return () => {
      live = false;
    };
  }, []);

  const redirecting = loading.value || !!profile.value;
  const name = status?.organisation?.name;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-end px-4 sm:px-6">
        <ModeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-6 py-10 text-center">
            <Image
              src="/icons/logo2.png"
              alt=""
              width={56}
              height={56}
              className="size-14"
              priority
            />

            {redirecting || !status ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : status.needsSetup ? (
              <>
                <div className="space-y-2">
                  <h1 className="text-2xl font-bold tracking-tight">
                    Welcome to GradeBook
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    This server hasn&apos;t been set up yet. Sign in to name
                    your organisation and add its schools.
                  </p>
                </div>
                <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}>
                  Sign in to set up
                  <ArrowRight className="size-4" />
                </Link>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {name ?? "GradeBook"}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Sign in with your school email to see your courses,
                    grades and messages.
                  </p>
                </div>
                <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}>
                  Sign in
                  <ArrowRight className="size-4" />
                </Link>
                <p className="text-xs text-muted-foreground">
                  New here? Sign in, then join your school with the code your
                  school gives you.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="px-4 py-6 text-center text-xs text-muted-foreground">
        {name ? `${name} · ` : ""}Powered by GradeBook
      </footer>
    </div>
  );
}
