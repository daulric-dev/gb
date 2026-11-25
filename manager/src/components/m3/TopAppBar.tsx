import React from "react";

export interface TopAppBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({ title, subtitle, actions }) => {
  return (
    <header className="h-16 px-6 bg-[var(--md-sys-color-surface)] border-b border-[var(--md-sys-color-outline-variant)] flex items-center justify-between shrink-0 select-none z-10">
      <div>
        <h1 className="text-xl font-semibold text-[var(--md-sys-color-on-surface)] leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)]">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-primary)]">
          Gradebook Manager
        </span>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
};
