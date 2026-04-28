export interface AcademicYear {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Term {
  id: string;
  academic_year_id: string;
  name: "michaelmas" | "hilary" | "trinity";
  start_date: string;
  end_date: string;
  exam_weight: number;
  coursework_weight: number;
  is_ministry_reporting: boolean;
  sort_order: number;
}

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export const termLabel: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};
