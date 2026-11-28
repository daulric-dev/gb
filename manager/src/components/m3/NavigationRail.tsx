import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/theme/ThemeContext";
import appIcon from "@/assets/app-icon.png";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
}

export interface NavigationRailProps {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onAddInstance?: () => void;
}

export const NavigationRail: React.FC<NavigationRailProps> = ({
  items,
  activeId,
  onSelect,
}) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <aside className="w-20 shrink-0 h-screen bg-[var(--md-sys-color-surface-container)] flex flex-col items-center py-4 border-r border-[var(--md-sys-color-outline-variant)] select-none z-20">
      {/* App Logo */}
      <div className="flex flex-col items-center gap-1 mb-4">
        <div className="size-10 rounded-[12px] bg-[var(--md-sys-color-surface-container-high)] flex items-center justify-center shadow-sm overflow-hidden">
          <img src={appIcon} alt="GradeBook" className="size-8 object-contain" />
        </div>
      </div>

      {/* Spacer — no FAB, nav rail is cleaner without it */}

      {/* Navigation items */}
      <nav className="flex-1 flex flex-col gap-3 w-full px-2">
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="flex flex-col items-center gap-1 w-full py-1 text-center group cursor-pointer"
            >
              <div
                className={`w-14 h-8 rounded-full flex items-center justify-center transition-all duration-150 relative ${
                  isActive
                    ? "bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]"
                    : "text-[var(--md-sys-color-on-surface-variant)] group-hover:bg-[var(--md-sys-color-surface-container-high)]"
                }`}
              >
                {item.icon}
                {item.badge && (
                  <span className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[var(--md-sys-color-tertiary)] text-[var(--md-sys-color-on-tertiary)]">
                    {item.badge}
                  </span>
                )}
              </div>
              <span
                className={`text-[11px] font-medium leading-none max-w-full truncate px-1 ${
                  isActive
                    ? "text-[var(--md-sys-color-on-surface)] font-bold"
                    : "text-[var(--md-sys-color-on-surface-variant)]"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Bottom theme switch */}
      <div className="pt-2 border-t border-[var(--md-sys-color-outline-variant)] w-full flex justify-center">
        <button
          onClick={toggleTheme}
          title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className="size-10 rounded-full flex items-center justify-center text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors cursor-pointer"
        >
          {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
      </div>
    </aside>
  );
};
