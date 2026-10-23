"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound, usePathname, useRouter } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowLeft,
  FileText,
  LayoutDashboard,
  PlugZap,
  School,
} from "lucide-react";
import { useProfile } from "@/providers/AuthProvider";
import { homePathFor, loginPath } from "@/lib/routing";
import { loadPlatformAdmin, platformAdmin } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeToggle } from "@/components/layout/mode-toggle";

const NAV = [
  { href: "/platform", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/platform/schools", label: "Schools", icon: School },
  { href: "/platform/invoices", label: "Invoices", icon: FileText },
  { href: "/platform/providers", label: "Providers", icon: PlugZap },
];

/**
 * The operator dashboard for the hosted platform. Outside the school chrome:
 * a platform admin need not belong to a school. Everyone else - and every
 * self-hosted deployment, where `/platform/*` answers 404 - gets a 404 here.
 */
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useSignals();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { profile, loading } = useProfile();
  const signedIn = !loading.value && !!profile.value;

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) {
      router.replace(loginPath(window.location.pathname));
      return;
    }
    void loadPlatformAdmin();
  }, [loading.value, profile.value, router]);

  if (signedIn && platformAdmin.value === false) notFound();

  if (!signedIn || platformAdmin.value !== true) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  const isActive = (href: string, exact?: boolean) =>
    exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/platform" className="flex items-center gap-2 overflow-hidden">
            <Image
              src="/icons/logo2.png"
              alt=""
              width={24}
              height={24}
              className="size-6 shrink-0"
            />
            <span className="truncate text-sm font-semibold">
              GradeBook Platform
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href={homePathFor(profile.value)} />}
            >
              <ArrowLeft className="mr-1.5 size-4" />
              <span className="hidden sm:inline">Back to app</span>
            </Button>
            <ModeToggle />
          </div>
        </div>
        <nav className="mx-auto max-w-6xl px-2">
          <div className="flex gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
    </div>
  );
}
