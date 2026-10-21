"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { termName, type TermOption, type YearOption } from "@/lib/courses/calendar";

const NONE = "none";

/**
 * Academic year and term pickers. A course may sit in a year and, within it,
 * optionally a term; changing the year clears a term that no longer fits.
 */
export function CourseCalendarFields({
  years,
  terms,
  yearId,
  termId,
  onChangeAction,
  disabled,
}: {
  years: YearOption[];
  terms: TermOption[];
  yearId: string;
  termId: string;
  onChangeAction: (next: { yearId: string; termId: string }) => void;
  disabled?: boolean;
}) {
  const yearTerms = terms.filter((t) => t.academic_year_id === yearId);

  const yearItems = [
    { value: NONE, label: "No academic year" },
    ...years.map((y) => ({
      value: y.id,
      label: y.is_active ? `${y.name} (active)` : y.name,
    })),
  ];
  const termItems = [
    { value: NONE, label: "Whole year" },
    ...yearTerms.map((t) => ({ value: t.id, label: termName(t.name) })),
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>Academic year</Label>
        <Select
          value={yearId || NONE}
          disabled={disabled}
          onValueChange={(v) => {
            const next = v === NONE ? "" : (v as string);
            const keepTerm = terms.some(
              (t) => t.id === termId && t.academic_year_id === next,
            );
            onChangeAction({ yearId: next, termId: keepTerm ? termId : "" });
          }}
          items={yearItems}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Term</Label>
        <Select
          value={termId || NONE}
          disabled={disabled || !yearId}
          onValueChange={(v) =>
            onChangeAction({ yearId, termId: v === NONE ? "" : (v as string) })
          }
          items={termItems}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {termItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
