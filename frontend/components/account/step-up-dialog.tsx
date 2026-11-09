"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
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
  useSignals();
  const open = useSignal(false);
  const code = useSignal("");
  const error = useSignal<string | null>(null);
  const sending = useSignal(false);
  const verifying = useSignal(false);
  const cooldown = useSignal(0);
  const { profile } = useProfile();
  const email = profile.value?.email ?? null;
  const prompt = useMemo(
    () =>
      createStepUpPrompt((next) => {
        open.value = next;
      }),
    [open],
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    cooldown.value = RESEND_COOLDOWN;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      const c = cooldown.value;
      if (c <= 1 && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
      cooldown.value = Math.max(0, c - 1);
    }, 1000);
  }, [cooldown]);

  const send = useCallback(async () => {
    sending.value = true;
    error.value = null;
    try {
      await sendStepUpCode();
      startCooldown();
    } catch (err) {
      error.value = userMessage(err, "Failed to send the code");
    } finally {
      sending.value = false;
    }
  }, [startCooldown, sending, error]);

  useEffect(() => {
    setStepUpHandler(() => {
      code.value = "";
      error.value = null;
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
  }, [prompt, send, code, error]);

  const verify = useCallback(
    async (value: string) => {
      if (value.length !== STEP_UP_CODE_LENGTH || verifying.value) return;
      verifying.value = true;
      error.value = null;
      try {
        await verifyStepUpCode(value);
        prompt.confirmed();
      } catch (err) {
        error.value = userMessage(err, "Verification failed");
        code.value = "";
      } finally {
        verifying.value = false;
      }
    },
    [prompt, verifying, error, code],
  );

  return (
    <Dialog
      open={open.value}
      onOpenChange={(o) => {
        if (!o && !verifying.value) prompt.dismissed();
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
            void verify(code.value);
          }}
        >
          <InputOTP
            maxLength={STEP_UP_CODE_LENGTH}
            value={code.value}
            autoFocus
            disabled={verifying.value}
            aria-label="Confirmation code"
            aria-invalid={!!error.value}
            onChange={(v) => {
              const next = cleanStepUpCode(v);
              code.value = next;
              if (error.value) error.value = null;
              if (next.length === STEP_UP_CODE_LENGTH) void verify(next);
            }}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3].map((i) => (
                <InputOTPSlot key={i} index={i} className="size-9" aria-invalid={!!error.value} />
              ))}
            </InputOTPGroup>
            <InputOTPSeparator className="hidden sm:flex" />
            <InputOTPGroup>
              {[4, 5, 6, 7].map((i) => (
                <InputOTPSlot key={i} index={i} className="size-9" aria-invalid={!!error.value} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <p className="min-h-5 text-center text-sm text-destructive" role="alert">
            {error.value}
          </p>

          <DialogFooter className="w-full sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void send()}
              disabled={sending.value || cooldown.value > 0}
            >
              {sending.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {cooldown.value > 0 ? `Resend code (${cooldown.value}s)` : "Send code"}
            </Button>
            <Button
              type="submit"
              disabled={verifying.value || code.value.length !== STEP_UP_CODE_LENGTH}
            >
              {verifying.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Verify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
