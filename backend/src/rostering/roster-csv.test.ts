import { describe, expect, test } from 'bun:test';
import {
  isOneRosterBundle,
  parseOneRosterCsv,
  parseTemplates,
  templateCsv,
  templateKindOf,
  TEMPLATES,
} from './roster-csv';
import { isZip, readZip, ZipError } from './zip';
import { BUNDLE_12, makeZip } from '@/test/roster-fixtures';

const asMap = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));

describe('OneRoster 1.2 CSV bundle', () => {
  const snap = parseOneRosterCsv(asMap(BUNDLE_12));

  test('reads orgs, sessions, users (roles from roles.csv), classes and enrolments', () => {
    expect(snap.orgs.map((o) => o.sourcedId)).toEqual(['org-1']); // tobedeleted dropped
    expect(snap.sessions.map((s) => s.sourcedId)).toEqual(['y26', 't1']);
    expect(snap.sessions[1]).toMatchObject({ type: 'term', parentSourcedId: 'y26', startDate: '2026-09-01' });
    expect(snap.users.map((u) => [u.sourcedId, u.kind])).toEqual([
      ['u-s1', 'student'],
      ['u-s2', 'student'],
      ['u-t1', 'staff'],
    ]);
    expect(snap.users[0]).toMatchObject({ email: 'jordan.rivera@school.org', identifier: '1001', orgSourcedIds: ['org-1'] });
    expect(snap.classes).toEqual([
      { sourcedId: 'c-1', title: 'Mathematics 7A', classCode: 'MATH7A', schoolSourcedId: 'org-1', termSourcedIds: ['t1'] },
    ]);
    // administrator enrolments carry no course role
    expect(snap.enrollments.map((e) => [e.sourcedId, e.role])).toEqual([
      ['e-1', 'student'],
      ['e-2', 'student'],
      ['e-3', 'teacher'],
    ]);
    expect(snap.present.sort()).toEqual(['classes', 'enrollments', 'orgs', 'sessions', 'staff', 'students']);
  });

  test('malformed rows become row errors with their line; good rows still load', () => {
    const messages = snap.errors.map((e) => `${e.file}:${e.line}:${e.message}`);
    expect(messages).toContainEqual(expect.stringContaining('academicsessions.csv:4:Unknown session type "quarterish"'));
    expect(messages).toContainEqual(expect.stringContaining('users.csv:7:email "not-an-email" is not an email address'));
    expect(messages).toContainEqual(expect.stringContaining('classes.csv:3:sourcedId is empty'));
    // parents and disabled users are skipped silently
    expect(snap.errors.some((e) => e.sourcedId === 'u-p1' || e.sourcedId === 'u-off')).toBe(false);
  });

  test('1.1 layout: role and orgSourcedIds on users.csv', () => {
    const s = parseOneRosterCsv(
      asMap({
        'users.csv': 'sourcedId,enabledUser,orgSourcedIds,role,givenName,familyName,email\nu1,true,"org-1,org-2",teacher,Ada,L,ada@x.org\n',
      }),
    );
    expect(s.users[0]).toMatchObject({ kind: 'staff', orgSourcedIds: ['org-1', 'org-2'] });
    expect(s.present).toEqual(['students', 'staff']);
  });

  test('a missing required column is a file error, and that part is not present', () => {
    const s = parseOneRosterCsv(asMap({ 'classes.csv': 'sourcedId,title\nc1,Maths\n' }));
    expect(s.errors[0].message).toBe('Missing column: schoolSourcedId');
    expect(s.present).toEqual([]);
    expect(s.classes).toEqual([]);
  });

  test('duplicate sourcedIds keep the first row', () => {
    const s = parseOneRosterCsv(asMap({ 'orgs.csv': 'sourcedId,name\no1,A\no1,B\n' }));
    expect(s.orgs).toEqual([{ sourcedId: 'o1', name: 'A', type: null, identifier: null }]);
    expect(s.errors[0].message).toContain('Duplicate');
  });

  test('quoted fields, CRLF and a BOM', () => {
    const s = parseOneRosterCsv(asMap({ 'orgs.csv': '﻿sourcedId,name\r\no1,"North, ""High"""\r\n' }));
    expect(s.orgs[0].name).toBe('North, "High"');
  });

  test('isOneRosterBundle', () => {
    expect(isOneRosterBundle(asMap(BUNDLE_12))).toBe(true);
    expect(isOneRosterBundle(new Map([['students.csv', '']]))).toBe(false);
  });
});

describe('GradeBook templates', () => {
  test('every template has a header and an example; kinds are detected from the first column', () => {
    for (const kind of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
      expect(templateKindOf(templateCsv(kind))).toBe(kind);
    }
    expect(templateKindOf('name,email\n')).toBeNull();
  });

  test('students, staff, classes and enrolments make one snapshot; orgs from the school column', () => {
    const snap = parseTemplates([
      { name: 'students.csv', text: templateCsv('students') + 'S-2,Sam,,,,,\n' },
      { name: 'staff.csv', text: templateCsv('staff') },
      { name: 'classes.csv', text: templateCsv('classes') },
      { name: 'enrolments.csv', text: templateCsv('enrolments') + 'C-MATH7A,T-201,teacher\n' },
    ]);
    expect(snap.errors).toEqual([]);
    expect(snap.users.map((u) => [u.sourcedId, u.kind, u.orgSourcedIds[0]])).toEqual([
      ['S-1001', 'student', 'MAIN'],
      ['S-2', 'student', 'default'],
      ['T-201', 'staff', 'MAIN'],
    ]);
    expect(snap.orgs.map((o) => o.sourcedId).sort()).toEqual(['MAIN', 'default']);
    expect(snap.sessions.map((s) => [s.sourcedId, s.type, s.parentSourcedId])).toEqual([
      ['year:2026-2027', 'schoolYear', null],
      ['term:2026-2027:Term 1', 'term', 'year:2026-2027'],
    ]);
    expect(snap.classes[0].termSourcedIds).toEqual(['term:2026-2027:Term 1']);
    expect(snap.enrollments.map((e) => [e.sourcedId, e.role])).toEqual([
      ['C-MATH7A:S-1001', 'student'],
      ['C-MATH7A:T-201', 'teacher'],
    ]);
    expect(snap.present.sort()).toEqual(['classes', 'enrollments', 'sessions', 'staff', 'students']);
  });

  test('a students-only upload never marks staff or classes present', () => {
    const snap = parseTemplates([{ name: 'students.csv', text: templateCsv('students') }]);
    expect(snap.present).toEqual(['students']);
  });

  test('malformed template rows', () => {
    const snap = parseTemplates([
      { name: 'students.csv', text: 'student_id,first_name,last_name,email,date_of_birth\n,A,B,,\nS1,,,x@,2020-13-01\nS2,C,D,,\nS2,E,F,,\n' },
      { name: 'staff.csv', text: 'staff_id,first_name,last_name,email\nT1,Ada,L,\n' },
      { name: 'enrolments.csv', text: 'class_id,person_id,role\nC1,S2,principal\n' },
      { name: 'other.csv', text: 'name,email\n' },
    ]);
    const msgs = snap.errors.map((e) => `${e.file}:${e.line}:${e.message}`);
    expect(msgs).toEqual([
      'students.csv:2:student_id is empty',
      'students.csv:3:first_name and last_name are empty; email "x@" is not an email address; date_of_birth is not a date (YYYY-MM-DD)',
      'students.csv:5:Duplicate id; the first row is used',
      'staff.csv:2:email is required for staff',
      'enrolments.csv:2:Unknown role "principal" (student, teacher or ta)',
      'other.csv:1:Not a GradeBook template: the first column must be student_id, staff_id or class_id',
    ]);
    expect(snap.users.map((u) => u.sourcedId)).toEqual(['S2']);
  });
});

describe('zip', () => {
  test('reads deflated and stored entries by lower-cased base name', () => {
    for (const deflate of [true, false]) {
      const zip = makeZip({ 'export/Users.csv': 'a,b\n', '__MACOSX/._users.csv': 'junk', 'orgs.csv': 'x' }, deflate);
      expect(isZip(zip)).toBe(true);
      const files = readZip(zip);
      expect([...files.keys()].sort()).toEqual(['orgs.csv', 'users.csv']);
      expect(files.get('users.csv')!.toString()).toBe('a,b\n');
    }
  });

  test('refuses non-zips and entries over the size cap (zip bombs)', () => {
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow(ZipError);
    const big = makeZip({ 'users.csv': 'x'.repeat(10_000) });
    expect(() => readZip(big, { entry: 1000, total: 5000 })).toThrow(ZipError);
  });
});
