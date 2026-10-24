/**
 * Local types for the Academic Calendar feature — mirrors the web app's
 * `app/dashboard/academic-calendar/_components/types.ts`.
 */

export interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface Term {
  id: string;
  academic_year_id: string;
  /** Free text, e.g. "Term 1" or "Fall". */
  name: string;
  start_date: string;
  end_date: string;
  sort_order: number;
}

const LEGACY_TERM_LABELS: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};

/** Display name for a term. Old rows hold lowercase enum slugs. */
export function termLabel(name: string): string {
  return LEGACY_TERM_LABELS[name] ?? name;
}

/** Active years first, then most-recent start date. */
export function sortYearsActiveFirst(years: AcademicYear[]): AcademicYear[] {
  return [...years].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
  });
}
