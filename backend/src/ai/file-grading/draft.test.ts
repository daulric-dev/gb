import { describe, expect, test } from 'bun:test';
import { validateSchema, SchemaError } from '../json-schema';
import { TRUNCATION_MARKER } from './file-grading.constants';
import { fileRubricSchema, fileScoreSchema } from './file-grading.prompts';
import {
  assembleWork,
  cleanRubricAnswer,
  cleanScoreAnswer,
  keepEvidence,
  normaliseForMatch,
  restorer,
  rubricLines,
  userMessage,
  type RubricForPrompt,
} from './draft';

const RUBRIC: RubricForPrompt = {
  title: 'Essay',
  criteria: [
    { id: 'crit-1', title: 'Argument', description: 'A clear case', points: 10, ratings: [{ id: 'r1', label: 'Strong', description: null, points: 10 }, { id: 'r2', label: 'Weak', description: null, points: 4 }] },
    { id: 'crit-2', title: 'Style', description: null, points: 5, ratings: [{ id: 'r3', label: 'Clear', description: null, points: 5 }] },
  ],
};

describe('assembleWork', () => {
  test('parts fit: nothing cut', () => {
    const w = assembleWork([{ label: 'file 1 (a.txt)', text: 'hello' }, { label: 'file 2', text: 'world' }], 100);
    expect(w.truncated).toBe(false);
    expect(w.chars).toBe(10);
    expect(w.body).toContain('<part source="file 1 (a.txt)">\nhello\n</part>');
  });

  test('over the budget: cut with the marker, later parts left out and flagged', () => {
    const w = assembleWork([{ label: 'a', text: 'x'.repeat(80) }, { label: 'b', text: 'y'.repeat(50) }, { label: 'c', text: 'z' }], 100);
    expect(w.sent).toEqual([80, 20, 0]);
    expect(w.cut).toEqual([false, true, true]);
    expect(w.truncated).toBe(true);
    expect(w.body).toContain(TRUNCATION_MARKER);
    expect(w.body).not.toContain('z');
  });

  test('labels cannot break out of the tag', () => {
    expect(assembleWork([{ label: 'x"><evil', text: 't' }], 10).body).toContain('source="xevil"');
  });
});

describe('prompt building', () => {
  test('rubric lines use short references, never ids, and teacher text is scrubbed', () => {
    const { lines, refs } = rubricLines(RUBRIC, (s) => s.replace('clear', '[x]'));
    expect(lines).toContain('c1. Argument (10 points): A clear case'.replace('clear', '[x]'));
    expect(lines).toContain('  c1-r2. Weak (4 points)');
    expect(lines).not.toContain('crit-1');
    expect(refs.level.get('c2-r1')).toMatchObject({ criterionId: 'crit-2', id: 'r3' });
  });

  test('the user message wraps the work in <student_work> and carries notes', () => {
    const work = assembleWork([{ label: 'f', text: 'body' }], 100);
    const msg = userMessage({ title: 'T', instructions: null, mode: 'score', points: 20, work, notes: ['A file could not be read'] });
    expect(msg).toContain('Points available: 20');
    expect(msg).toContain('- A file could not be read');
    expect(msg.indexOf('<student_work>')).toBeLessThan(msg.indexOf('body'));
    expect(msg.trim().endsWith('</student_work>')).toBe(true);
  });
});

describe('evidence quotes', () => {
  const hay = normaliseForMatch('The mitochondria is the “powerhouse” of the cell.\nIt makes ATP — energy.');

  test('quotes found in the work are kept (case, spacing, quote marks and dashes ignored)', () => {
    const { kept, dropped } = keepEvidence(['the  Mitochondria is', '"powerhouse" of the cell', 'makes ATP - energy', '...is the'], hay);
    expect(kept).toEqual(['the  Mitochondria is', 'powerhouse" of the cell', 'makes ATP - energy', 'is the']);
    expect(dropped).toBe(0);
  });

  test('invented, too-short, duplicate and HTML quotes are dropped', () => {
    const { kept, dropped } = keepEvidence(['the cell divides by mitosis', 'is', 'makes ATP', 'MAKES atp', '<b>nope</b>'], hay);
    expect(kept).toEqual(['makes ATP']);
    expect(dropped).toBe(4);
  });
});

describe('model output', () => {
  const { refs } = rubricLines(RUBRIC, (s) => s);
  const hay = normaliseForMatch('I think school should start later because sleep matters.');

  test('the rubric schema rejects unknown references, extra keys and long evidence lists', () => {
    const schema = fileRubricSchema(['c1', 'c2'], ['c1-r1', 'c1-r2', 'c2-r1']);
    const good = { criteria: [{ criterion: 'c1', level: 'c1-r1', comment: 'ok', evidence: [] }], feedback: 'f', feedbackEvidence: [] };
    validateSchema(schema, good);
    expect(() => validateSchema(schema, { ...good, criteria: [{ ...good.criteria[0], criterion: 'c9' }] })).toThrow(SchemaError);
    expect(() => validateSchema(schema, { ...good, extra: 1 })).toThrow(SchemaError);
    expect(() => validateSchema(schema, { ...good, criteria: [{ ...good.criteria[0], evidence: ['a', 'b', 'c', 'd'] }] })).toThrow(SchemaError);
  });

  test('the score schema keeps the score within the points and the statuses known', () => {
    const schema = fileScoreSchema(20);
    const good = { score: 12, requirements: [{ requirement: 'Thesis', status: 'met', comment: '', evidence: [] }], feedback: '', feedbackEvidence: [] };
    validateSchema(schema, good);
    expect(() => validateSchema(schema, { ...good, score: 21 })).toThrow(SchemaError);
    expect(() => validateSchema(schema, { ...good, requirements: [{ ...good.requirements[0], status: 'great' }] })).toThrow(SchemaError);
  });

  test('rubric answer: every criterion listed, a level of another criterion dropped, evidence checked, names restored', () => {
    const draft = cleanRubricAnswer(
      {
        criteria: [
          { criterion: 'c1', level: 'c1-r1', comment: 'Good case, [Student]. <script>x</script>', evidence: ['school should start later', 'made up quote here'] },
          { criterion: 'c2', level: 'c1-r2', comment: 'Clear.', evidence: [] },
          { criterion: 'c1', level: 'c1-r2', comment: 'duplicate', evidence: [] },
        ],
        feedback: 'Well done, [Student].',
        feedbackEvidence: ['sleep matters'],
      },
      RUBRIC,
      refs,
      hay,
      restorer('Amelia'),
    );
    expect(draft.criteria).toEqual([
      { criterionId: 'crit-1', title: 'Argument', maxPoints: 10, ratingId: 'r1', ratingLabel: 'Strong', points: 10, comment: 'Good case, Amelia. x', evidence: ['school should start later'] },
      { criterionId: 'crit-2', title: 'Style', maxPoints: 5, ratingId: null, ratingLabel: null, points: null, comment: 'Clear.', evidence: [] },
    ]);
    expect(draft.suggestedTotal).toBe(10);
    expect(draft.feedback).toBe('Well done, Amelia.');
    expect(draft.feedbackEvidence).toEqual(['sleep matters']);
    expect(draft.evidenceDropped).toBe(1);
  });

  test('score answer: clamped and rounded, empty requirements dropped', () => {
    const d = cleanScoreAnswer(
      { score: 12.3456, requirements: [{ requirement: ' ', status: 'met', comment: '', evidence: [] }, { requirement: 'Argue', status: 'partly', comment: 'c', evidence: ['nope nope nope'] }], feedback: 'f', feedbackEvidence: [] },
      20,
      hay,
      restorer(null),
    );
    expect(d.score).toBe(12.35);
    expect(d.requirements).toEqual([{ requirement: 'Argue', status: 'partly', comment: 'c', evidence: [] }]);
    expect(d.evidenceDropped).toBe(1);
    expect(cleanScoreAnswer({ ...{ score: 99 }, requirements: [], feedback: '', feedbackEvidence: [] } as never, 20, hay, restorer(null)).score).toBe(20);
  });
});
