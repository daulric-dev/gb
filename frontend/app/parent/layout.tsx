"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { LogOut, Settings, Users } from "lucide-react";
import { useProfile } from "@/providers/AuthProvider";
import { homePathFor, isParentProfile, loginPath } from "@/lib/routing";
import { api } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";
import {
  childTabs,
  isParentJoinPath,
  personName,
  selectedChildId,
  switchChildPath,
  type ParentChild,
} from "@/lib/parent";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { FeatureDisabled } from "@/components/feature-disabled";
import { Skeleton } from "@/components/ui/skeleton";
import { ParentContext } from "./_components/parent-context";

/**
 * The parent portal shell: a child switcher and that child's tabs. Only
 * parent accounts get it; the accept and link pages (how an account becomes
 * a parent) render without it.
 */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  useSignals();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { profile, loading } = useProfile();
  const joining = isParentJoinPath(pathname);

  const kids = useSignal<ParentChild[]>([]);
  const kidsLoaded = useSignal(false);
  const disabled = useSignal(false);

  const isParent = isParentProfile(profile.value);

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) {
      router.replace(loginPath(`${window.location.pathname}${window.location.search}`));
      return;
    }
    if (!joining && !isParent) router.replace(homePathFor(profile.value));
  }, [loading.value, profile.value, router, joining, isParent]);

  const reload = useCallback(() => {
    api<ParentChild[]>("/parent/children")
      .then((list) => {
        kids.value = list;
        disabled.value = false;
      })
      .catch((err) => {
        if (isFeatureDisabledError(err)) disabled.value = true;
        else toast.error("Couldn't load your children");
        kids.value = [];
      })
      .finally(() => (kidsLoaded.value = true));
  }, [kids, kidsLoaded, disabled]);

  useEffect(() => {
    if (isParent) reload();
  }, [isParent, reload]);

  if (loading.value || !profile.value) return null;

  if (joining) {
    return (
      <div className="min-h-dvh bg-background">
        <main className="mx-auto max-w-lg p-4 md:p-8">{children}</main>
      </div>
    );
  }
  if (!isParent) return null;

  const selectedId = selectedChildId(pathname, kids.value);
  const selected = kids.value.find((c) => c.id === selectedId) ?? null;
  const tabs = selected ? childTabs(selected.id, selected.visibility) : [];

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      toast.error("Failed to log out");
    }
    router.push("/login");
  }

  return (
    <ParentContext.Provider value={{ children: kids.value, selected, reload }}>
      <div className="min-h-dvh bg-background">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <Link href="/parent" className="flex shrink-0 items-center gap-2">
              {selected?.school.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by the API/CDN
                <img src={selected.school.logoUrl} alt="" className="size-6 rounded object-contain" />
              ) : (
                <Image src="/icons/logo2.png" alt="" width={24} height={24} className="size-6" />
              )}
              <span className="hidden text-sm font-semibold sm:inline">Parent portal</span>
            </Link>

            {kids.value.length > 1 && selected && (
              <NativeSelect
                aria-label="Child"
                value={selected.id}
                onChange={(e) => router.push(switchChildPath(pathname, e.target.value))}
                className="min-w-0"
              >
                {kids.value.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {personName(c, "Child")}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
            {kids.value.length === 1 && selected && (
              <span className="truncate text-sm">{personName(selected, "Child")}</span>
            )}

            <div className="ml-auto flex items-center gap-1">
              <ModeToggle />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Settings"
                nativeButton={false}
                render={<Link href="/parent/settings" />}
              >
                <Settings className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Log out" onClick={handleLogout}>
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>

          {tabs.length > 0 && !pathname.startsWith("/parent/settings") && (
            <nav className="mx-auto max-w-5xl px-2" aria-label={`${personName(selected, "Child")}'s pages`}>
              <div className="flex gap-1 overflow-x-auto">
                {tabs.map((t) => {
                  const active = pathname === t.href;
                  return (
                    <Link
                      key={t.href}
                      href={t.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                        active
                          ? "border-primary font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          )}
        </header>

        <main className="mx-auto max-w-5xl p-4 md:p-6">
          {!kidsLoaded.value ? (
            <Skeleton className="h-40 w-full" />
          ) : disabled.value ? (
            <FeatureDisabled
              title="The parent portal is turned off"
              description="Your child's school has not switched the parent portal on. Ask the school if you expected to see it."
            />
          ) : kids.value.length === 0 && !pathname.startsWith("/parent/settings") ? (
            <div className="space-y-4 rounded-lg border border-dashed p-8 text-center">
              <Users className="mx-auto size-8 text-muted-foreground" />
              <p className="font-medium">No children linked yet</p>
              <p className="text-sm text-muted-foreground">
                Use the invitation email or the code your child&apos;s school gave you.
              </p>
              <Button nativeButton={false} render={<Link href="/parent/link" />}>Enter a code</Button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </ParentContext.Provider>
  );
}
