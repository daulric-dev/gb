"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Ban,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  QrCode,
  RefreshCw,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { joinUrl } from "@/lib/course-join";

/**
 * Students with an account can join the course themselves with this code from
 * the portal, or by scanning its QR (a `/join/<code>` link). Regenerating
 * invalidates the old code and its QR; disabling stops both.
 */
export function JoinCodeCard({
  courseId,
  joinCode,
  canManage,
  onChangedAction,
}: {
  courseId: string;
  joinCode: string | null;
  canManage: boolean;
  onChangedAction: () => void;
}) {
  useSignals();
  const working = useSignal(false);

  async function regenerate() {
    working.value = true;
    try {
      await api<{ joinCode: string }>(`/courses/${courseId}/join-code`, {
        method: "POST",
        body: {},
      });
      toast.success(joinCode ? "New code generated" : "Join code enabled");
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to generate");
    } finally {
      working.value = false;
    }
  }

  async function disable() {
    working.value = true;
    try {
      await api(`/courses/${courseId}/join-code`, { method: "DELETE" });
      toast.success("Join code disabled");
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to disable");
    } finally {
      working.value = false;
    }
  }

  async function copy(text: string | null, label = "Copied") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Could not copy");
    }
  }

  const link =
    joinCode && typeof window !== "undefined"
      ? joinUrl(joinCode, window.location.origin)
      : null;

  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Join code</p>
          <p className="text-xs text-muted-foreground">
            {joinCode
              ? "Students enter this in the portal to enrol themselves."
              : "Self-enrolment is off. Enable a code to let students join."}
          </p>
        </div>
        {joinCode && (
          <button
            type="button"
            onClick={() => copy(joinCode)}
            className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 font-mono text-lg font-semibold tracking-widest hover:bg-muted"
            title="Copy"
          >
            {joinCode}
            <Copy className="size-3.5 text-muted-foreground" />
          </button>
        )}
        {joinCode && link && (
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              <QrCode className="mr-1.5 size-3.5" />
              QR code
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Join with a QR code</DialogTitle>
                <DialogDescription>
                  Students scan this with their phone camera or the GradeBook
                  app to join. It stops working if you disable or regenerate the
                  code.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="rounded-xl bg-white p-4">
                  <QRCodeSVG
                    value={link}
                    size={256}
                    level="M"
                    marginSize={0}
                    title={`Join code ${joinCode}`}
                  />
                </div>
                <p className="font-mono text-2xl font-semibold tracking-widest">
                  {joinCode}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(link, "Link copied")}
                >
                  <Link2 className="mr-1.5 size-3.5" />
                  Copy join link
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {canManage && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={regenerate}
              disabled={working.value}
            >
              {working.value ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-3.5" />
              )}
              {joinCode ? "Regenerate" : "Enable"}
            </Button>
            {joinCode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={disable}
                disabled={working.value}
              >
                <Ban className="mr-1.5 size-3.5" />
                Disable
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
