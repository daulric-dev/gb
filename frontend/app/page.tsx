"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { GraduationCap, BarChart3, FileSpreadsheet, ListOrdered, Building2, ShieldCheck, ArrowRight, ChevronDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useProfile } from "@/lib/use-profile";

const features = [
  {
    icon: GraduationCap,
    title: "Class Management",
    description:
      "Create classes, enroll students, and assign teachers with an intuitive dashboard built for schools.",
  },
  {
    icon: BarChart3,
    title: "Flexible Grading",
    description:
      "Support for both term-based and year-based grading models with customisable coursework and exam weights.",
  },
  {
    icon: FileSpreadsheet,
    title: "Report Generation",
    description:
      "Export individual student and class-wide reports as PDF, CSV, or Excel spreadsheets in one click.",
  },
  {
    icon: ListOrdered,
    title: "Subject Management",
    description:
      "Add subjects, set custom sort order with drag-and-drop, and configure grading weights per subject.",
  },
  {
    icon: Building2,
    title: "Multi-School Support",
    description:
      "Each school operates independently with its own classes, students, and academic years - all under one platform.",
  },
  {
    icon: ShieldCheck,
    title: "Secure & Simple Auth",
    description:
      "Email-based OTP sign-in - no passwords to remember, reset, or compromise. Fast and secure.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const { profile } = useProfile({ optional: true });

  const navigateWithTransition = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      const target = profile.value ? "/dashboard" : "/login";
      const el = containerRef.current;
      if (!el) {
        router.push(target);
        return;
      }
      el.classList.add("animate-fade-out-down");
      el.addEventListener("animationend", () => router.push(target), {
        once: true,
      });
    },
    [router, profile],
  );

  return (
    <div ref={containerRef} className="flex min-h-screen flex-col bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-lg">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/icons/logo2.png"
              alt="GradeBook logo"
              width={28}
              height={28}
              className="size-7 shrink-0"
            />
            <div className="min-w-0">
              <span className="text-lg font-bold tracking-tight block leading-tight">
                GradeBook
              </span>
              <span className="text-[10px] text-muted-foreground/60 block -mt-0.5">
                by daulric.dev
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <ModeToggle />
            <button
              onClick={navigateWithTransition}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {profile.value ? "Dashboard" : "Sign In"}
            </button>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-4 pb-20 pt-24 text-center sm:pt-32">
        <div className="animate-fade-in-up mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Modern Grading
            <br />
            <span className="text-primary">Made Simple</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
            A complete grade book platform for schools. Manage classes, record
            grades, and generate beautiful reports - all from one place.
          </p>
        </div>

        <div className="animate-fade-in-up-delay-1 mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <button
            onClick={navigateWithTransition}
            className={cn(buttonVariants({ size: "lg" }), "gap-2")}
          >
            {profile.value ? "Continue" : "Get Started"}
            <ArrowRight className="size-4" />
          </button>
          <button
            onClick={() => {
              document
                .getElementById("features")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "gap-2",
            )}
          >
            Learn More
            <ChevronDown className="size-4" />
          </button>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="border-t bg-muted/30 px-4 py-20 sm:px-6 sm:py-28"
      >
        <div className="mx-auto max-w-6xl">
          <div className="animate-fade-in-up mb-14 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything your school needs
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              From day-to-day grade entry to end-of-year reports, GradeBook
              covers the full workflow.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => {
              const delay =
                i < 3
                  ? `animate-fade-in-up-delay-${i + 1}`
                  : "animate-fade-in-up-delay-3";
              return (
                <Card
                  key={f.title}
                  className={`${delay} transition-shadow hover:shadow-md`}
                >
                  <CardContent className="flex flex-col gap-3 pt-2">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <f.icon className="size-5" />
                    </div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {f.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="border-t px-4 py-20 text-center sm:px-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Ready to simplify grading?
          </h2>
          <p className="mt-4 text-muted-foreground">
            Sign in with your email and start managing your school&apos;s grades
            in minutes.
          </p>
          <button
            onClick={navigateWithTransition}
            className={cn(buttonVariants({ size: "lg" }), "mt-8 gap-2")}
          >
            Get Started - It&apos;s Free
            <ArrowRight className="size-4" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row">
          <span>
            &copy; {new Date().getFullYear()} GradeBook. All rights reserved.
          </span>
          <div className="flex gap-4">
            <a
              href="/privacy"
              className="hover:text-foreground underline-offset-4 hover:underline"
            >
              Privacy Policy
            </a>
            <a
              href="/terms"
              className="hover:text-foreground underline-offset-4 hover:underline"
            >
              Terms of Service
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}