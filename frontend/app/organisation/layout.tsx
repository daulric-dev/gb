"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound, usePathname, useRouter } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  ArrowLeft,
  ClipboardClock,
  LayoutDashboard,
  LogOut,
  Puzzle,
  School,
  Settings,
  ShieldCheck,
  ToggleRight,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import type { FeatureKey, OrganisationFeature } from "@/lib/features";
import { useProfile } from "@/providers/AuthProvider";
import { homePathFor, loginPath, ORGANISATION_PATH } from "@/lib/routing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  /** Shown only while this feature is on for the organisation. */
  feature?: FeatureKey;
}[] = [
  {
    href: ORGANISATION_PATH,
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
  },
  { href: `${ORGANISATION_PATH}/schools`, label: "Schools", icon: School },
  {
    href: `${ORGANISATION_PATH}/admins`,
    label: "Administrators",
    icon: ShieldCheck,
  },
  {
    href: `${ORGANISATION_PATH}/audit-log`,
    label: "Audit log",
    icon: ClipboardClock,
  },
  {
    href: `${ORGANISATION_PATH}/features`,
    label: "Features",
    icon: ToggleRight,
  },
  {
    href: `${ORGANISATION_PATH}/lti`,
    label: "External tools",
    icon: Puzzle,
    feature: "lti",
  },
  { href: `${ORGANISATION_PATH}/settings`, label: "Settings", icon: Settings },
];

/**
 * The organisation console. Outside the school chrome: an organisation admin
 * need not belong to a school. Everyone else gets a 404 here (the API answers
 * 403 to them anyway).
 */
export default function OrganisationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useSignals();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { profile, loading } = useProfile();
  const signedIn = !loading.value && !!profile.value;
  const isOrgAdmin = signedIn && !!profile.value?.is_org_admin;
  // The organisation's own switches (profile.features is the admin's school,
  // if any). Re-read when the profile is refreshed, as the Features page does
  // after saving.
  const [orgFeatures, setOrgFeatures] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!isOrgAdmin) return;
    let live = true;
    api<OrganisationFeature[]>("/organisation/features")
      .then((list) => {
        if (live) setOrgFeatures(Object.fromEntries(list.map((f) => [f.key, f.enabled])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isOrgAdmin, profile.value]);

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) router.replace(loginPath(window.location.pathname));
  }, [loading.value, profile.value, router]);

  if (signedIn && !profile.value?.is_org_admin) notFound();

  if (!signedIn) {
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

  const me = profile.value!;
  const isActive = (href: string, exact?: boolean) =>
    exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  const fullName =
    [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email;
  const initials =
    [me.first_name?.[0], me.last_name?.[0]]
      .filter(Boolean)
      .join("")
      .toUpperCase() ||
    me.email[0]?.toUpperCase() ||
    "?";

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      toast.error("Failed to log out");
    }
    router.push("/login");
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link
            href={ORGANISATION_PATH}
            className="flex min-w-0 items-center gap-2 overflow-hidden"
          >
            <Image
              src="/icons/logo2.png"
              alt=""
              width={24}
              height={24}
              className="size-6 shrink-0"
            />
            <span className="truncate text-sm font-semibold">
              {me.organisation?.name ?? "Organisation"}
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ModeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 px-1.5"
                    aria-label="Account menu"
                  />
                }
              >
                <Avatar className="size-7">
                  {me.avatar_url && <AvatarImage src={me.avatar_url} alt="" />}
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-40 truncate sm:inline">
                  {fullName}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <div className="px-1.5 py-1">
                  <p className="truncate text-sm font-medium">{fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {me.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => router.push(`${ORGANISATION_PATH}/account`)}
                >
                  <UserRound className="mr-2 size-4" />
                  Account settings
                </DropdownMenuItem>
                {me.school && (
                  <DropdownMenuItem
                    onClick={() => router.push(homePathFor(me))}
                  >
                    <ArrowLeft className="mr-2 size-4" />
                    Back to app
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <nav className="mx-auto max-w-6xl px-2">
          <div className="flex gap-1 overflow-x-auto">
            {NAV.filter((item) => !item.feature || orgFeatures[item.feature]).map((item) => {
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
