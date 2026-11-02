"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { setStepUpHandler } from "@/lib/api";
import {
  cleanStepUpCode,
  createStepUpPrompt,
  sendStepUpCode,
  STEP_UP_CODE_LENGTH,
  verifyStepUpCode,
} from "@/lib/step-up";
import { useProfile } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { userMessage } from "@/lib/errors";

const RESEND_COOLDOWN = 30;

/**
 * "Confirm it's you": shown when an API call made with `{ stepUp: true }`
 * comes back `STEP_UP_REQUIRED` (changing single sign-on settings). Sends a
 * code to the signed-in user's email as it opens, takes the 8-digit code and,
 * once verified, lets `api()` retry the original request. Mounted once, in
 * the root layout inside AuthProvider; renders nothing until needed.
 */
export function StepUpDialogHost() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const { profile } = useProfile();
  const email = profile.value?.email ?? null;
  const prompt = useMemo(() => createStepUpPrompt(setOpen), []);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
        return Math.max(0, c - 1);
      });
    }, 1000);
  }, []);

  const send = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      await sendStepUpCode();
      startCooldown();
    } catch (err) {
      setError(userMessage(err, "Failed to send the code"));
    } finally {
      setSending(false);
    }
  }, [startCooldown]);

  useEffect(() => {
    setStepUpHandler(() => {
      setCode("");
      setError(null);
      const answer = prompt.request();
      // Auto-send as it opens: the code is the only thing they need.
      void send();
      return answer;
    });
    return () => {
      setStepUpHandler(null);
      prompt.dismissed();
      if (timer.current) clearInterval(timer.current);
    };
  }, [prompt, send]);

  const verify = useCallback(
    async (value: string) => {
      if (value.length !== STEP_UP_CODE_LENGTH || verifying) return;
      setVerifying(true);
      setError(null);
      try {
        await verifyStepUpCode(value);
        prompt.confirmed();
      } catch (err) {
        setError(userMessage(err, "Verification failed"));
        setCode("");
      } finally {
        setVerifying(false);
      }
    },
    [prompt, verifying],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !verifying) prompt.dismissed();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Confirm it&apos;s you
          </DialogTitle>
          <DialogDescription>
            Single sign-on decides who can sign in to the school, so changes
            need a code from your email.{" "}
            {email ? (
              <>
                We sent one to <span className="font-medium text-foreground">{email}</span>.
              </>
            ) : (
              "We sent one to your email."
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <InputOTP
            maxLength={STEP_UP_CODE_LENGTH}
            value={code}
            autoFocus
            disabled={verifying}
            aria-label="Confirmation code"
            aria-invalid={!!error}
            onChange={(v) => {
              const next = cleanStepUpCode(v);
              setCode(next);
              if (error) setError(null);
              if (next.length === STEP_UP_CODE_LENGTH) void verify(next);
            }}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3].map((i) => (
                <InputOTPSlot key={i} index={i} className="size-9" aria-invalid={!!error} />
              ))}
            </InputOTPGroup>
            <InputOTPSeparator className="hidden sm:flex" />
            <InputOTPGroup>
              {[4, 5, 6, 7].map((i) => (
                <InputOTPSlot key={i} index={i} className="size-9" aria-invalid={!!error} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <p className="min-h-5 text-center text-sm text-destructive" role="alert">
            {error}
          </p>

          <DialogFooter className="w-full sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void send()}
              disabled={sending || cooldown > 0}
            >
              {sending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {cooldown > 0 ? `Resend code (${cooldown}s)` : "Send code"}
            </Button>
            <Button
              type="submit"
              disabled={verifying || code.length !== STEP_UP_CODE_LENGTH}
            >
              {verifying && <Loader2 className="mr-2 size-4 animate-spin" />}
              Verify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
