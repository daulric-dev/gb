import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface M3CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "elevated" | "filled" | "outlined";
  interactive?: boolean;
}

export const M3Card: React.FC<M3CardProps> = ({
  children,
  variant = "elevated",
  interactive = false,
  className,
  ...props
}) => {
  const base = "rounded-[16px] p-5 transition-all duration-200 overflow-hidden";

  const variants = {
    elevated:
      "bg-[var(--md-sys-color-surface-container-low)] shadow-sm border border-transparent",
    filled:
      "bg-[var(--md-sys-color-surface-container)] border border-transparent",
    outlined:
      "bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]",
  };

  const interactiveClasses = interactive
    ? "cursor-pointer hover:shadow-md hover:border-[var(--md-sys-color-outline)] active:scale-[0.99]"
    : "";

  return (
    <div
      className={twMerge(clsx(base, variants[variant], interactiveClasses, className))}
      {...props}
    >
      {children}
    </div>
  );
};
export { M3Card as Card } from './Card';
