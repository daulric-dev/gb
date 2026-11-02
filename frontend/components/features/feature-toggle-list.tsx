"use client";

import { Lock } from "lucide-react";
import { groupFeatures } from "@/lib/features";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface FeatureToggleRow {
  key: string;
  label: string;
  description: string;
  requires: string[];
  /** Shown instead of a working switch, e.g. "Turned off by your organisation". */
  lockedReason?: string | null;
}

/**
 * Feature switches grouped for display. A feature whose requirement is off
 * shows as off with its switch disabled and a "Needs …" hint.
 */
export function FeatureToggleList({
  rows,
  value,
  disabled,
  onToggle,
}: {
  rows: FeatureToggleRow[];
  /** Whether each feature is (to be) on. */
  value: Record<string, boolean>;
  disabled?: boolean;
  onToggle: (key: string, on: boolean) => void;
}) {
  const labelOf = (key: string) =>
    rows.find((r) => r.key === key)?.label ?? key;

  return (
    <div className="space-y-6">
      {groupFeatures(rows).map((group) => (
        <section key={group.title} className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.title}
          </h3>
          <ul className="divide-y">
            {group.items.map((row) => {
              const missing = row.requires.filter((r) => !value[r]);
              const locked = !!row.lockedReason;
              const blocked = locked || missing.length > 0;
              const id = `feature-${row.key}`;
              return (
                <li
                  key={row.key}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor={id} className="font-medium">
                      {row.label}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {row.description}
                    </p>
                    {locked ? (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="size-3" />
                        {row.lockedReason}
                      </p>
                    ) : missing.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Needs {missing.map(labelOf).join(" and ")} switched on.
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    id={id}
                    checked={!blocked && !!value[row.key]}
                    disabled={disabled || blocked}
                    onCheckedChange={(on) => onToggle(row.key, on)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
