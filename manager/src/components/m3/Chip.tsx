import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface M3ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "assist" | "filter" | "suggestion";
  selected?: boolean;
  icon?: React.ReactNode;
  label?: string;
}

export const M3Chip: React.FC<M3ChipProps> = ({
  children,
  variant = "assist",
  selected = false,
  icon,
  label,
  className,
  ...props
}) => {
  const base =
    "inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-xs font-medium transition-all duration-150 select-none cursor-pointer outline-none";

  const variants = {
    assist:
      "border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]",
    filter: selected
      ? "bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] font-semibold border-transparent"
      : "border border-[var(--md-sys-color-outline-variant)] bg-transparent text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)]",
    suggestion:
      "bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] border border-transparent hover:bg-[var(--md-sys-color-surface-container-highest)]",
  };

  return (
    <button
      className={twMerge(clsx(base, variants[variant], className))}
      {...props}
    >
      {icon && <span className="size-3.5 flex items-center justify-center">{icon}</span>}
      {label ?? children}
    </button>
  );
};
export { M3Chip as Chip } from './Chip';
