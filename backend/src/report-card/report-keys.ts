import { ForbiddenException } from '@nestjs/common';

/** The storage area every report card PDF lives under. */
export const REPORT_AREA = 'report-cards';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string, what: string): string {
  if (!UUID.test(value)) throw new Error(`Invalid ${what} id for a report key`);
  return value.toLowerCase();
}

/**
 * Where one student's term report is stored:
 * `report-cards/schools/<school>/terms/<term>/<student>.pdf`. Deterministic,
 * so generating again (a retried job, a re-publish) overwrites the same
 * object instead of leaving copies behind.
 */
export function reportKey(schoolId: string, termId: string, studentId: string): string {
  return `${REPORT_AREA}/schools/${uuid(schoolId, 'school')}/terms/${uuid(termId, 'term')}/${uuid(studentId, 'student')}.pdf`;
}

/** The prefix every report of one school is stored under. */
export function schoolReportPrefix(schoolId: string): string {
  return `${REPORT_AREA}/schools/${uuid(schoolId, 'school')}/`;
}

/**
 * Refuse to read a key outside the school's own prefix. A document row is
 * always written with its school's key, so this only trips on a bug or a
 * tampered row, and then it fails closed.
 */
export function assertKeyInSchool(key: string | null | undefined, schoolId: string): string {
  if (
    !key ||
    !key.startsWith(schoolReportPrefix(schoolId)) ||
    key.includes('..') ||
    !key.endsWith('.pdf')
  ) {
    throw new ForbiddenException('This report is not in your school');
  }
  return key;
}
