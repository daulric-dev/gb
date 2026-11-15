import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { leftAtFor, withLeftAt } from './student-left-at';

const NOW = new Date('2026-11-14T10:00:00Z');
const EARLIER = new Date('2026-09-01T00:00:00Z');

describe('leftAtFor (same rule as the student_set_left_at trigger)', () => {
  test('active or null: no leaving date', () => {
    expect(leftAtFor(null, true, NOW)).toBeNull();
    expect(leftAtFor(null, null, NOW)).toBeNull();
    expect(leftAtFor({ is_active: false, left_at: EARLIER }, true, NOW)).toBeNull();
    expect(leftAtFor({ is_active: false, left_at: EARLIER }, null, NOW)).toBeNull();
  });

  test('a new inactive student, or active -> inactive: now', () => {
    expect(leftAtFor(null, false, NOW)).toEqual(NOW);
    expect(leftAtFor({ is_active: true, left_at: null }, false, NOW)).toEqual(NOW);
    expect(leftAtFor({ is_active: null, left_at: null }, false, NOW)).toEqual(NOW);
    // A stale date on an active row is not reused.
    expect(leftAtFor({ is_active: true, left_at: EARLIER }, false, NOW)).toEqual(NOW);
  });

  test('staying inactive keeps the original date (now if it was lost)', () => {
    expect(leftAtFor({ is_active: false, left_at: EARLIER }, false, NOW)).toEqual(EARLIER);
    expect(leftAtFor({ is_active: false, left_at: null }, false, NOW)).toEqual(NOW);
  });
});

describe('withLeftAt', () => {
  test('adds left_at only when the data sets is_active', () => {
    expect(withLeftAt({ first_name: 'A' }, null, NOW)).toEqual({ first_name: 'A' });
    expect(withLeftAt({ is_active: false }, { is_active: true, left_at: null }, NOW)).toEqual({
      is_active: false,
      left_at: NOW,
    });
    expect(withLeftAt({ is_active: true, school_id: 's' }, null, NOW)).toEqual({
      is_active: true,
      school_id: 's',
      left_at: null,
    });
  });

  test('refuses an update operator, which would hide the new value', () => {
    expect(() => withLeftAt({ is_active: { set: false } }, null, NOW)).toThrow();
  });
});

// ── repository guard ─────────────────────────────────────────────────────────

const ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'generated' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** The text of a call starting at `open` (the index of its "("). */
function callText(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** `call` without its `where: { ... }` filter (is_active there only reads). */
function withoutWhere(call: string): string {
  const at = call.search(/\bwhere:\s*\{/);
  if (at === -1) return call;
  const open = call.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < call.length; i++) {
    if (call[i] === '{') depth++;
    else if (call[i] === '}' && --depth === 0) return call.slice(0, at) + withoutWhere(call.slice(i + 1));
  }
  return call;
}

/** Student writes that set is_active without stamping left_at. */
function unstampedStudentWrites(files: string[]): string[] {
  const bad: string[] = [];
  const write = /\.student\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\(/g;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(write)) {
      const call = withoutWhere(callText(text, m.index! + m[0].length - 1));
      if (call.includes('withLeftAt(')) continue;
      const where = `${relative(ROOT, file)}:${text.slice(0, m.index).split('\n').length}`;
      if (/\bis_active\b/.test(call)) {
        bad.push(where);
        continue;
      }
      // `data: someVar` where someVar gets an is_active elsewhere in the file.
      for (const d of call.matchAll(/\bdata:\s*([A-Za-z_$][\w$]*)\s*[,}\n]/g)) {
        const v = d[1];
        if (new RegExp(`\\b${v}\\.is_active\\s*=|\\b${v}\\s*=\\s*\\{[^}]*\\bis_active\\b`).test(text)) bad.push(where);
      }
    }
    if (/\bstudents?:\s*\{\s*(create|createMany|update|updateMany|upsert)\b[\s\S]{0,400}?\bis_active\b/.test(text)) {
      bad.push(`${relative(ROOT, file)} (nested student write)`);
    }
  }
  return bad;
}

describe('every student write that sets is_active keeps left_at in step', () => {
  test('src and scripts', () => {
    const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'scripts'))];
    expect(unstampedStudentWrites(files)).toEqual([]);
  });

  test('the guard catches a bare write (self-check)', () => {
    const tmp = join(__dirname, '__left_at_guard_fixture__.ts');
    writeFileSync(
      tmp,
      [
        'await tx.student.update({ where: { id }, data: { is_active: false } });',
        'const set: any = {}; set.is_active = true;',
        'await tx.student.update({ where: { id }, data: set });',
        'await tx.student.update({ where: { id }, data: withLeftAt({ is_active: false }, before) });',
        'await tx.student.updateMany({ where: { is_active: false, left_at: null }, data: { left_at: now } });',
      ].join('\n'),
    );
    try {
      expect(unstampedStudentWrites([tmp])).toHaveLength(2);
    } finally {
      unlinkSync(tmp);
    }
  });
});
