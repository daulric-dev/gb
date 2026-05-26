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

export interface BandInput {
  label: string;
  minPercentage: number;
  maxPercentage: number;
  gpaPoints: number | null;
  isPass: boolean;
}
