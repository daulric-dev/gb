import React, { useState, useId } from "react";
import { Eye, EyeOff } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface M3TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  supportingText?: string;
  error?: string;
  leadingIcon?: React.ReactNode;
  isSecret?: boolean;
}

export const M3TextField: React.FC<M3TextFieldProps> = ({
  label,
  supportingText,
  error,
  leadingIcon,
  isSecret = false,
  type = "text",
  className,
  value,
  defaultValue,
  id: externalId,
  onFocus,
  onBlur,
  ...props
}) => {
  const autoId = useId();
  const inputId = externalId || autoId;

  const [showSecret, setShowSecret] = useState(false);
  const [focused, setFocused] = useState(false);

  const hasValue = value !== undefined
    ? String(value).length > 0
    : (defaultValue !== undefined && String(defaultValue).length > 0);

  const isFloated = focused || hasValue;
  const effectiveType = isSecret ? (showSecret ? "text" : "password") : type;

  return (
    <div className={twMerge(clsx("relative flex flex-col gap-1 w-full text-left", className))}>
      <div className="relative flex items-center">
        {leadingIcon && (
          <span className="absolute left-3 text-[var(--md-sys-color-on-surface-variant)] flex items-center pointer-events-none z-10">
            {leadingIcon}
          </span>
        )}

        <input
          id={inputId}
          type={effectiveType}
          value={value}
          defaultValue={defaultValue}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          className={clsx(
            "h-14 w-full rounded-t-[8px] rounded-b-none bg-[var(--md-sys-color-surface-container-highest)]",
            "px-4 pt-5 pb-1 text-sm text-[var(--md-sys-color-on-surface)]",
            "border-b-2 transition-colors duration-150 outline-none",
            focused
              ? error
                ? "border-[var(--md-sys-color-error)]"
                : "border-[var(--md-sys-color-primary)]"
              : error
                ? "border-[var(--md-sys-color-error)]"
                : "border-[var(--md-sys-color-outline)]",
            leadingIcon && "pl-10",
            isSecret && "pr-10"
          )}
          {...props}
        />

        {/* Floating label */}
        <label
          htmlFor={inputId}
          className={clsx(
            "absolute pointer-events-none transition-all duration-150 origin-left",
            leadingIcon ? "left-10" : "left-4",
            isFloated
              ? clsx(
                  "top-2 text-[11px]",
                  focused
                    ? error ? "text-[var(--md-sys-color-error)]" : "text-[var(--md-sys-color-primary)]"
                    : error ? "text-[var(--md-sys-color-error)]" : "text-[var(--md-sys-color-on-surface-variant)]"
                )
              : "top-4 text-sm text-[var(--md-sys-color-on-surface-variant)]"
          )}
        >
          {label}
        </label>

        {isSecret && (
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-3 text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] p-1 rounded-full cursor-pointer z-10"
            tabIndex={-1}
            aria-label={showSecret ? "Hide" : "Show"}
          >
            {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>

      {(error || supportingText) && (
        <span
          className={clsx(
            "text-xs px-4",
            error
              ? "text-[var(--md-sys-color-error)] font-medium"
              : "text-[var(--md-sys-color-on-surface-variant)]"
          )}
        >
          {error || supportingText}
        </span>
      )}
    </div>
  );
};

export { M3TextField as TextField };
