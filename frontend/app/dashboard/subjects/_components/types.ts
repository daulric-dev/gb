export interface Subject {
  id: string;
  school_id: string;
  name: string;
  code: string | null;
  is_graded: boolean;
  sort_order: number;
}

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
