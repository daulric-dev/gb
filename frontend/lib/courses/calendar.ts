import { api } from "@/lib/api";

/** The academic-year fields the course screens need. */
export interface YearOption {
  id: string;
  name: string;
  is_active: boolean;
  start_date: string;
}

export interface TermOption {
  id: string;
  academic_year_id: string;
  name: string;
  sort_order: number;
}

const LEGACY_TERM_LABELS: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};

/** Term names are free text now; old rows still hold lowercase enum slugs. */
export function termName(name: string): string {
  return LEGACY_TERM_LABELS[name] ?? name;
}

/**
 * Every academic year (active first, then newest) with its terms. Failures
 * degrade to empty lists: the calendar only labels and filters courses.
 */
export async function loadCalendar(): Promise<{
  years: YearOption[];
  terms: TermOption[];
}> {
  const years = await api<YearOption[]>("/academic-years").catch(
    () => [] as YearOption[],
  );
  years.sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
  });

  const termLists = await Promise.all(
    years.map((y) =>
      api<TermOption[]>(`/terms?yearId=${y.id}`).catch(() => [] as TermOption[]),
    ),
  );
  const terms = termLists
    .flat()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return { years, terms };
}

/** "2026/27 · Term 1" for a course, or null when it has no year. */
export function calendarLabel(
  course: { academicYearId: string | null; termId: string | null },
  years: YearOption[],
  terms: TermOption[],
): string | null {
  const year = years.find((y) => y.id === course.academicYearId);
  const term = terms.find((t) => t.id === course.termId);
  const parts = [year?.name, term ? termName(term.name) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
