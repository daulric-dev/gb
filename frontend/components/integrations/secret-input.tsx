"use client";

import { useState } from "react";
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
  const [shown, setShown] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={shown ? "text" : "password"}
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
          aria-label={`${shown ? "Hide" : "Show"} ${label}`}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
