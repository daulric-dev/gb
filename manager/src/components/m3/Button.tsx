import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface M3ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "filled" | "tonal" | "outlined" | "text" | "fab";
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

export const M3Button: React.FC<M3ButtonProps> = ({
  children,
  variant = "filled",
  icon,
  trailingIcon,
  size = "md",
  className,
  disabled,
  ...props
}) => {
  const base =
    "inline-flex items-center justify-center font-medium transition-all duration-200 outline-none select-none disabled:opacity-38 disabled:pointer-events-none cursor-pointer";

  const sizeClasses = {
    sm: "h-8 px-3 text-xs gap-1.5 rounded-[9999px]",
    md: "h-10 px-5 text-sm gap-2 rounded-[9999px]",
    lg: "h-12 px-6 text-base gap-2.5 rounded-[9999px]",
  };

  const variants = {
    filled:
      "bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] shadow-sm hover:shadow-md hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_90%,var(--md-sys-color-on-primary))]",
    tonal:
      "bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] hover:shadow-sm hover:bg-[color-mix(in_srgb,var(--md-sys-color-secondary-container)_90%,var(--md-sys-color-on-secondary-container))]",
    outlined:
      "border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-primary)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_8%,transparent)]",
    text: "text-[var(--md-sys-color-primary)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_8%,transparent)]",
    fab: "h-14 px-5 rounded-[16px] text-sm font-semibold bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] shadow-md hover:shadow-lg hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary-container)_90%,var(--md-sys-color-on-primary-container))] gap-3",
  };

  return (
    <button
      className={twMerge(clsx(base, sizeClasses[size], variants[variant], className))}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      {children}
      {trailingIcon && <span className="shrink-0 flex items-center">{trailingIcon}</span>}
    </button>
  );
};
export { M3Button as Button } from './Button';
