import type { Rubric } from "@/lib/course";

/** Pure peer review helpers (no API import, so they test without React Native). */

export type PeerReviewState = "scheduled" | "not_started" | "open" | "closed";

export interface ReviewMark {
  criterionId: string;
  ratingId: string | null;
  points: number;
  comment: string | null;
}

/** A short phrase for the review window. */
export function windowLabel(
  s: { state: PeerReviewState; opensAt: string | null; closesAt: string },
  format: (iso: string) => string,
): string {
  switch (s.state) {
    case "scheduled":
      return s.opensAt ? `Opens ${format(s.opensAt)}` : "Opens after the due date";
    case "not_started":
      return "Waiting for your teacher to start it";
    case "open":
      return `Open until ${format(s.closesAt)}`;
    case "closed":
      return `Closed ${format(s.closesAt)}`;
  }
}

/** Set one criterion's mark, keeping the others. */
export function withMark(marks: ReviewMark[], mark: ReviewMark): ReviewMark[] {
  return [...marks.filter((m) => m.criterionId !== mark.criterionId), mark];
}

/** Every rubric criterion marked (needed to hand in). */
export function marksComplete(rubric: Rubric | null, marks: ReviewMark[]): boolean {
  if (!rubric) return true;
  return rubric.criteria.every((c) => marks.some((m) => m.criterionId === c.id));
}
