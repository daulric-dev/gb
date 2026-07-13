/**
 * Local types for the Grade Scales admin feature. Mirrors the web frontend's
 * `app/dashboard/grade-scales/_components/types.ts`. Defined locally here (not
 * in `@/lib/types`) since this feature is self-contained.
 */

export type GradeScaleType = "letter" | "gpa" | "pass_fail";

export interface GradeScaleBand {
  id: string;
  label: string;
  minPercentage: number;
  maxPercentage: number;
  gpaPoints: number | null;
  isPass: boolean;
  sortOrder: number;
}

export interface GradeScaleSummary {
  id: string;
  schoolId: string;
  name: string;
  scaleType: GradeScaleType;
  isDefault: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GradeScaleDetail extends GradeScaleSummary {
  bands: GradeScaleBand[];
}

/** Band payload sent to the API (no id / sortOrder). */
export interface BandPayload {
  label: string;
  minPercentage: number;
  maxPercentage: number;
  gpaPoints: number | null;
  isPass: boolean;
}
