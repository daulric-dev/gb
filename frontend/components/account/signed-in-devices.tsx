"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Laptop, Loader2, LogOut, Smartphone } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { resetBillingState } from "@/lib/billing";
import {
  DEVICES_ANCHOR,
  isMobileDevice,
  lastActiveLabel,
  methodLabel,
  type SignedInSession,
} from "@/lib/sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Signed-in devices: every live session of this account (this one marked),
 * with a sign-out button on every other device and "Sign out of all other devices". Used on the
 * staff settings page and the student portal's settings page; the "New
 * sign-in" email links here (#devices).
 */
export function SignedInDevices() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SignedInSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    api<SignedInSession[]>("/auth/sessions")
      .then((rows) => live && setSessions(rows))
      .catch(() => {
        if (!live) return;
        setSessions([]);
        toast.error("Failed to load signed-in devices");
      });
    return () => {
      live = false;
    };
  }, [version]);

  // Arriving from the email's link: bring the card into view once it renders.
  useEffect(() => {
    if (sessions && window.location.hash === `#${DEVICES_ANCHOR}`) {
      document.getElementById(DEVICES_ANCHOR)?.scrollIntoView({ block: "start" });
    }
  }, [sessions]);

  async function signOut(session: SignedInSession) {
    setBusy(session.id);
    try {
      await api(`/auth/sessions/${session.id}`, { method: "DELETE" });
      if (session.current) {
        resetBillingState();
        router.push("/login");
        return;
      }
      toast.success(`Signed out ${session.device}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to sign out");
    } finally {
      setBusy(null);
    }
  }

  async function signOutOthers() {
    setBusy("others");
    try {
      const { revoked } = await api<{ revoked: number }>(
        "/auth/sessions/revoke-others",
        { method: "POST" },
      );
      toast.success(
        revoked === 1 ? "Signed out 1 device" : `Signed out ${revoked} devices`,
      );
      setConfirmOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to sign out");
    } finally {
      setBusy(null);
    }
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Card id={DEVICES_ANCHOR} className="scroll-mt-20 p-6">
      <h2 className="text-lg font-semibold">Signed-in devices</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Where your account is signed in. Sign out any device you don&apos;t
        recognise. Each sign-in lasts at most 90 days, then you sign in again.
      </p>

      {sessions === null ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No devices to show.</p>
      ) : (
        <ul className="divide-y">
          {sessions.map((s) => {
            const Icon = isMobileDevice(s.device) ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{s.device}</span>
                    {s.current && <Badge>This device</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      lastActiveLabel(s),
                      s.ip,
                      methodLabel(s.method),
                      `Signed in ${new Date(s.createdAt).toLocaleDateString()}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {/* This device signs out from the account menu, not here. */}
                {!s.current && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void signOut(s)}
                    aria-label={`Sign out ${s.device}`}
                  >
                    {busy === s.id && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {others > 0 && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" className="mt-4" disabled={busy !== null}>
                <LogOut className="mr-2 size-4" />
                Sign out of all other devices
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sign out other devices?</DialogTitle>
              <DialogDescription>
                Every device except this one ({others}) will need to sign in
                again.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={busy !== null}
                onClick={() => void signOutOthers()}
              >
                {busy === "others" && <Loader2 className="mr-2 size-4 animate-spin" />}
                Sign out
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
