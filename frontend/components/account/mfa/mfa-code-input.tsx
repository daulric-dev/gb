"use client";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { cleanMfaCode, MFA_CODE_LENGTH } from "./mfa-api";

/** Six boxes for an authenticator code (3 + 3, as the apps show it). */
export function MfaCodeInput({
  value,
  onChange,
  invalid,
  disabled,
  autoFocus,
  slotClassName = "size-10 text-lg",
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  slotClassName?: string;
}) {
  return (
    <InputOTP
      maxLength={MFA_CODE_LENGTH}
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label="Authenticator code"
      aria-invalid={invalid}
      inputMode="numeric"
      autoComplete="one-time-code"
      onChange={(v) => onChange(cleanMfaCode(v))}
    >
      <InputOTPGroup>
        {[0, 1, 2].map((i) => (
          <InputOTPSlot key={i} index={i} className={slotClassName} aria-invalid={invalid} />
        ))}
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        {[3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} className={slotClassName} aria-invalid={invalid} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
