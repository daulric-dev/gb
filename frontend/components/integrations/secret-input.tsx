"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Eye, EyeOff } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

/** A password-style input with a show / hide toggle, for write-only secrets. */
export function SecretInput({
  id,
  value,
  placeholder,
  maxLength,
  label,
  onChangeAction,
}: {
  id?: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  /** For the toggle's accessible name: "Show <label>". */
  label: string;
  onChangeAction: (value: string) => void;
}) {
  useSignals();
  const shown = useSignal(false);
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={shown.value ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="new-password"
        spellCheck={false}
        aria-label={label}
        onChange={(e) => onChangeAction(e.target.value)}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={`${shown.value ? "Hide" : "Show"} ${label}`}
          aria-pressed={shown.value}
          onClick={() => (shown.value = !shown.value)}
        >
          {shown.value ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
