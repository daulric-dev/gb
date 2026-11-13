"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, UserX } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { blockerLink, blockersFromError, type DeletionBlocker } from "@/lib/account-deletion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Organisation console: delete someone's account for good (`DELETE
 * /organisation/users/:userId`, step-up). Refused while they own the
 * organisation or a school, or are its last administrator; the API's
 * blockers are shown with where to sort each out.
 */
export function DeleteUserAccountButton({
  userId,
  who,
  onDeletedAction,
}: {
  userId: string;
  who: string;
  onDeletedAction: () => void;
}) {
  useSignals();
  const open = useSignal(false);
  const typed = useSignal("");
  const busy = useSignal(false);
  const blockers = useSignal<DeletionBlocker[]>([]);

  async function remove() {
    busy.value = true;
    try {
      await api(`/organisation/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        stepUp: true,
      });
      toast.success(`${who}'s account was deleted`);
      open.value = false;
      onDeletedAction();
    } catch (err) {
      const refused = blockersFromError(err);
      if (refused) blockers.value = refused;
      else toast.error(userMessage(err, "Could not delete the account"));
    } finally {
      busy.value = false;
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          typed.value = "";
          blockers.value = [];
          open.value = true;
        }}
        title="Delete account"
      >
        <UserX className="size-4 text-destructive" />
        <span className="sr-only">Delete account</span>
      </Button>
      <Dialog open={open.value} onOpenChange={(v) => (open.value = v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete <span translate="no">{who}</span>&apos;s account?
            </DialogTitle>
            <DialogDescription>
              Their account, profile and sign-in are deleted for good and they are removed from
              every school; they are signed out everywhere. Student records stay with their school
              (erase those from the student&apos;s page). This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {blockers.value.length > 0 && (
            <div className="space-y-2 rounded-lg border border-destructive/50 p-3">
              <p className="text-sm font-medium">Sort these out first</p>
              <ul className="space-y-2">
                {blockers.value.map((b, i) => {
                  const link = blockerLink(b, { isOrgAdmin: true, activeSchoolId: null });
                  return (
                    <li key={`${b.code}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 text-muted-foreground">{b.message}</span>
                      {link && (
                        <Link href={link.href} className="shrink-0 font-medium underline">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`delete-user-${userId}`}>
              Type <strong>DELETE</strong> to confirm
            </Label>
            <Input
              id={`delete-user-${userId}`}
              value={typed.value}
              onChange={(e) => (typed.value = e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={busy.value || typed.value !== "DELETE"}
              onClick={() => void remove()}
            >
              {busy.value && <Loader2 className="size-4 animate-spin" />}
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
