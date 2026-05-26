import type { GradeScaleType } from './dto/create-grade-scale.dto';

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

export interface MessageResponse {
  message: string;
}

export function v1ScaleList(data: GradeScaleSummary[]): GradeScaleSummary[] {
  return data;
}

export function v1ScaleDetail(
  data: GradeScaleDetail | null,
): GradeScaleDetail | null {
  return data;
}

export function v1ScaleCreated(data: GradeScaleDetail): GradeScaleDetail {
  return data;
}

export function v1ScaleUpdated(data: GradeScaleDetail): GradeScaleDetail {
  return data;
}

export function v1BandsReplaced(data: GradeScaleDetail): GradeScaleDetail {
  return data;
}

export function v1ScaleDeleted(data: MessageResponse): MessageResponse {
  return data;
}

export function v1DefaultSet(data: GradeScaleDetail): GradeScaleDetail {
  return data;
}
