import type { Tables } from '@/types/database.types';

type ReportBook = Tables<{ schema: 'reporting' }, 'report_book'>;
type ReportBookEntry = Tables<{ schema: 'reporting' }, 'report_book_entry'>;

export function v1ReportList(data: ReportBook[]): ReportBook[] {
  return data;
}

export function v1ReportDetail(raw: ReportBook): ReportBook {
  return raw;
}

export function v1ReportGenerated(raw: any): any {
  return raw;
}

export function v1ReportUpdated(raw: ReportBook): ReportBook {
  return raw;
}

export function v1ClassSummary(raw: any): any {
  return raw;
}

export function v1ClassSummaryFiles(data: any[]): any[] {
  return data;
}

export function v1ClassSummaryUploaded(raw: any): any {
  return raw;
}

export function v1StudentReport(raw: any): any {
  return raw;
}

export function v1PdfHistory(data: any[]): any[] {
  return data;
}

export function v1PdfLatest(raw: any): any {
  return raw;
}

export function v1PdfSaved(raw: any): any {
  return raw;
}

export function v1PdfUploaded(raw: any): any {
  return raw;
}

export function v1ReportEntryUpdated(raw: ReportBookEntry): ReportBookEntry {
  return raw;
}
