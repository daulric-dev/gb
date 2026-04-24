import type { Tables } from '@/types/database.types';

type AcademicYear = Tables<'academic_year'>;

export function v1YearList(data: AcademicYear[]): AcademicYear[] {
  return data;
}

export function v1YearDetail(raw: AcademicYear): AcademicYear {
  return raw;
}

export function v1YearCreated(raw: AcademicYear): AcademicYear {
  return raw;
}

export function v1YearUpdated(raw: AcademicYear): AcademicYear {
  return raw;
}
