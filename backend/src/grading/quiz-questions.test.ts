import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import {
  answerRow,
  buildAttemptPlan,
  fileTypeAllowed,
  questionCredit,
  toSavedAnswer,
  toStudentQuestion,
  validateQuestion,
  type ScoringQuestion,
} from './quiz-questions';

const opt = (id: string, isCorrect = false, matchLabel: string | null = null, label = id) => ({
  id,
  label,
  isCorrect,
  matchLabel,
});
const question = (over: Partial<ScoringQuestion>): ScoringQuestion => ({
  kind: 'multiple_choice',
  points: 2,
  numericAnswer: null,
  numericTolerance: 0,
  partialCredit: false,
  options: [],
  ...over,
});

describe('validateQuestion', () => {
  test('multiple choice needs exactly one correct option', () => {
    expect(() => validateQuestion('multiple_choice', [{ label: 'a', isCorrect: true }], {})).toThrow(
      BadRequestException,
    );
    expect(() =>
      validateQuestion('multiple_choice', [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }], {}),
    ).toThrow('Only one option can be correct');
  });

  test('multiple select needs one or more correct, and keeps its scoring', () => {
    const { columns } = validateQuestion(
      'multiple_select',
      [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }, { label: 'c' }],
      { scoring: 'partial' },
    );
    expect(columns.partial_credit).toBe(true);
    expect(() => validateQuestion('multiple_select', [{ label: 'a' }, { label: 'b' }], {})).toThrow(
      'Mark at least one option as correct',
    );
  });

  test('numeric needs an answer and a tolerance of 0 or more', () => {
    expect(validateQuestion('numeric', [], { numericAnswer: 9.81, numericTolerance: 0.05 }).columns).toMatchObject({
      numeric_answer: 9.81,
      numeric_tolerance: 0.05,
    });
    expect(() => validateQuestion('numeric', [], {})).toThrow('Give the numeric answer');
    expect(() => validateQuestion('numeric', [], { numericAnswer: 1, numericTolerance: -1 })).toThrow(
      BadRequestException,
    );
  });

  test('matching needs every item matched; ordering needs two items', () => {
    expect(() => validateQuestion('matching', [{ label: 'a', matchLabel: '1' }, { label: 'b' }], {})).toThrow(
      'Give every item a match',
    );
    const { options } = validateQuestion('ordering', [{ label: 'first', isCorrect: true }, { label: 'second' }], {});
    expect(options.map((o) => o.isCorrect)).toEqual([false, false]);
    expect(() => validateQuestion('ordering', [{ label: 'only' }], {})).toThrow(BadRequestException);
  });

  test('essay and file upload take no options; file types are checked', () => {
    expect(validateQuestion('essay', [{ label: 'x' }], { rubricId: 'r-1' })).toEqual({
      options: [],
      columns: expect.objectContaining({ rubric_id: 'r-1' }),
    });
    expect(validateQuestion('file_upload', [], { fileTypes: ['.PDF', 'image/*'], fileMaxMb: 5 }).columns).toMatchObject({
      file_types: ['.pdf', 'image/*'],
      file_max_mb: 5,
    });
    expect(() => validateQuestion('file_upload', [], { fileTypes: ['pdf files'] })).toThrow(BadRequestException);
    expect(() => validateQuestion('file_upload', [], { fileMaxMb: 0 })).toThrow(BadRequestException);
  });

  test('short answer wordings are all correct', () => {
    expect(validateQuestion('short_answer', [{ label: 'Paris' }, { label: 'paris ' }], {}).options).toEqual([
      { label: 'Paris', isCorrect: true, matchLabel: null },
      { label: 'paris', isCorrect: true, matchLabel: null },
    ]);
  });
});

describe('fileTypeAllowed', () => {
  test('by extension, by MIME wildcard, or anything when empty', () => {
    expect(fileTypeAllowed(['.pdf'], { name: 'Essay.PDF', contentType: 'application/pdf' })).toBe(true);
    expect(fileTypeAllowed(['image/*'], { name: 'a.png', contentType: 'image/png' })).toBe(true);
    expect(fileTypeAllowed(['image/*'], { name: 'a.pdf', contentType: 'application/pdf' })).toBe(false);
    expect(fileTypeAllowed([], { name: 'x', contentType: '' })).toBe(true);
  });
});

describe('questionCredit (the shared quiz scoring rules)', () => {
  test('numeric: inside the tolerance, inclusive at its edge', () => {
    const q = question({ kind: 'numeric', numericAnswer: 3.14, numericTolerance: 0.01 });
    expect(questionCredit(q, { numeric: 3.15 }).credit).toBe(1);
    expect(questionCredit(q, { numeric: 3.13 }).credit).toBe(1);
    expect(questionCredit(q, { numeric: 3.16 }).credit).toBe(0);
    expect(questionCredit(question({ kind: 'numeric', numericAnswer: 10 }), { numeric: 10 }).credit).toBe(1);
    expect(questionCredit(q, { numeric: null }).credit).toBe(0);
  });

  test('multiple select: all or nothing', () => {
    const q = question({ kind: 'multiple_select', options: [opt('a', true), opt('b', true), opt('c')] });
    expect(questionCredit(q, { optionIds: ['a', 'b'] }).credit).toBe(1);
    expect(questionCredit(q, { optionIds: ['a'] }).credit).toBe(0);
    expect(questionCredit(q, { optionIds: ['a', 'b', 'c'] }).credit).toBe(0);
  });

  test('multiple select: partial credit takes wrong picks off, never below 0', () => {
    const q = question({
      kind: 'multiple_select',
      partialCredit: true,
      options: [opt('a', true), opt('b', true), opt('c'), opt('d')],
    });
    expect(questionCredit(q, { optionIds: ['a'] }).credit).toBe(0.5);
    expect(questionCredit(q, { optionIds: ['a', 'b', 'c'] }).credit).toBe(0.5);
    expect(questionCredit(q, { optionIds: ['a', 'c', 'd'] }).credit).toBe(0);
    expect(questionCredit(q, { optionIds: [] }).credit).toBe(0);
  });

  test('matching: every pair, or the share right', () => {
    const options = [opt('x', false, '1'), opt('y', false, '2'), opt('z', false, '3'), opt('w', false, '4')];
    const all = question({ kind: 'matching', options });
    const partial = question({ kind: 'matching', options, partialCredit: true });
    const matches = { x: '1', y: '2', z: '4', w: '3' };
    expect(questionCredit(all, { matches }).credit).toBe(0);
    expect(questionCredit(partial, { matches }).credit).toBe(0.5);
    expect(questionCredit(all, { matches: { x: '1', y: '2', z: '3', w: '4' } }).credit).toBe(1);
    expect(questionCredit(partial, { matches: {} }).credit).toBe(0);
  });

  test('ordering: every item in place, or the share in place', () => {
    const options = [opt('1'), opt('2'), opt('3'), opt('4')];
    expect(questionCredit(question({ kind: 'ordering', options }), { optionIds: ['1', '2', '3', '4'] }).credit).toBe(1);
    expect(questionCredit(question({ kind: 'ordering', options }), { optionIds: ['2', '1', '3', '4'] }).credit).toBe(0);
    expect(
      questionCredit(question({ kind: 'ordering', options, partialCredit: true }), { optionIds: ['2', '1', '3', '4'] })
        .credit,
    ).toBe(0.5);
  });

  test('short answer ignores case and surrounding spaces', () => {
    const q = question({ kind: 'short_answer', options: [opt('o', true, null, 'Paris')] });
    expect(questionCredit(q, { text: '  paris ' }).credit).toBe(1);
    expect(questionCredit(q, { text: 'Lyon' }).credit).toBe(0);
  });

  test('essay and file: wait for the teacher when answered, then points / question points', () => {
    const q = question({ kind: 'essay', points: 4 });
    expect(questionCredit(q, { text: 'An essay' })).toEqual({ credit: 0, needsMarking: true });
    expect(questionCredit(q, { text: '   ' })).toEqual({ credit: 0, needsMarking: false });
    expect(questionCredit(q, null)).toEqual({ credit: 0, needsMarking: false });
    expect(questionCredit(q, { text: 'x', manualPoints: 3 })).toEqual({ credit: 0.75, needsMarking: false });
    const f = question({ kind: 'file_upload', points: 2 });
    expect(questionCredit(f, { fileId: 'f-1' }).needsMarking).toBe(true);
    expect(questionCredit(f, { fileId: 'f-1', manualPoints: 5 }).credit).toBe(1);
  });
});

describe('buildAttemptPlan', () => {
  const fixed = [
    { id: 'f1', kind: 'multiple_choice', optionIds: ['a', 'b', 'c', 'd'] },
    { id: 'f2', kind: 'true_false', optionIds: ['t', 'f'] },
    { id: 'f3', kind: 'ordering', optionIds: ['o1', 'o2', 'o3'] },
  ];
  const bank = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, kind: 'numeric', optionIds: [] }));
  const input = { fixed, draws: [{ questions: bank, count: 3 }], shuffleQuestions: true, shuffleOptions: true };

  test('the same seed gives the same questions and orders (stable for resuming and re-scoring)', () => {
    expect(buildAttemptPlan(42, input)).toEqual(buildAttemptPlan(42, input));
  });

  test('draws N distinct bank questions besides the fixed ones', () => {
    const plan = buildAttemptPlan(7, input);
    expect(plan).toHaveLength(6);
    const ids = plan.map((p) => p.questionId);
    expect(new Set(ids).size).toBe(6);
    expect(ids.filter((id) => id.startsWith('b'))).toHaveLength(3);
    expect(plan.map((p) => p.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('different seeds draw differently', () => {
    const draws = new Set(
      Array.from({ length: 20 }, (_, s) =>
        buildAttemptPlan(s, { ...input, shuffleQuestions: false })
          .map((p) => p.questionId)
          .join(','),
      ),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  test('a small bank gives what it has; a question is never drawn twice', () => {
    const plan = buildAttemptPlan(1, {
      fixed: [],
      draws: [
        { questions: bank.slice(0, 2), count: 5 },
        { questions: bank.slice(0, 3), count: 3 },
      ],
      shuffleQuestions: false,
      shuffleOptions: false,
    });
    expect(plan.map((p) => p.questionId).sort()).toEqual(['b0', 'b1', 'b2']);
  });

  test('without shuffling: the quiz order, options as written', () => {
    const plan = buildAttemptPlan(3, { fixed, draws: [], shuffleQuestions: false, shuffleOptions: false });
    expect(plan.map((p) => p.questionId)).toEqual(['f1', 'f2', 'f3']);
    expect(plan[0].optionOrder).toEqual(['a', 'b', 'c', 'd']);
    expect(plan[1].optionOrder).toEqual(['t', 'f']);
  });

  test('ordering items are never shown in the right order; true/false never shuffles', () => {
    for (let seed = 0; seed < 50; seed++) {
      const plan = buildAttemptPlan(seed, { fixed, draws: [], shuffleQuestions: false, shuffleOptions: true });
      expect(plan[2].optionOrder).not.toEqual(['o1', 'o2', 'o3']);
      expect([...plan[2].optionOrder].sort()).toEqual(['o1', 'o2', 'o3']);
      expect(plan[1].optionOrder).toEqual(['t', 'f']);
    }
  });
});

describe('what a student is sent', () => {
  test('never the answer key', () => {
    const sent = toStudentQuestion(
      { id: 'q', prompt: 'Match', kind: 'matching', points: 2 },
      [
        { id: 'a', label: 'Apple', match_label: 'Red' },
        { id: 'b', label: 'Banana', match_label: 'Yellow' },
      ],
      ['b', 'a'],
    );
    expect(sent).toEqual({
      id: 'q',
      prompt: 'Match',
      kind: 'matching',
      points: 2,
      options: [
        { id: 'b', label: 'Banana' },
        { id: 'a', label: 'Apple' },
      ],
      matchChoices: ['Red', 'Yellow'],
    });
    const json = JSON.stringify(
      toStudentQuestion({ id: 'q2', prompt: 'p', kind: 'short_answer', points: 1 }, [
        { id: 'o', label: 'secret wording' },
      ]),
    );
    expect(json).not.toContain('secret wording');
    expect(json).not.toContain('isCorrect');
  });

  test('a file question carries its accepted types and size', () => {
    expect(
      toStudentQuestion({ id: 'q', prompt: 'p', kind: 'file_upload', points: 1, file_types: ['.pdf'], file_max_mb: 5 }, []),
    ).toMatchObject({ options: [], fileTypes: ['.pdf'], fileMaxMb: 5 });
  });
});

describe('answerRow', () => {
  const q = (kind: string, ids: string[] = []) => ({ kind, optionIds: new Set(ids) });
  test('keeps only answers of the right shape for the kind', () => {
    expect(answerRow(q('multiple_choice', ['a']), { questionId: 'q', optionId: 'z' })).toBeNull();
    expect(answerRow(q('multiple_select', ['a', 'b']), { questionId: 'q', optionIds: ['a', 'a', 'b'] })?.option_ids).toEqual([
      'a',
      'b',
    ]);
    expect(answerRow(q('multiple_select', ['a']), { questionId: 'q', optionIds: ['x'] })).toBeNull();
    expect(answerRow(q('numeric'), { questionId: 'q', numeric: 2.5 })?.numeric_answer).toBe(2.5);
    expect(answerRow(q('numeric'), { questionId: 'q', text: '2.5' })).toBeNull();
    expect(
      answerRow(q('matching', ['a']), { questionId: 'q', matches: [{ optionId: 'a', label: ' Red ' }] })?.matches,
    ).toEqual({ a: 'Red' });
    expect(answerRow(q('short_answer'), { questionId: 'q', text: 'x'.repeat(501) })).toBeNull();
    expect(answerRow(q('essay'), { questionId: 'q', text: 'x'.repeat(5000) })?.text_answer).toHaveLength(5000);
    expect(answerRow(q('file_upload'), { questionId: 'q', fileId: 'f' })?.file_id).toBe('f');
  });

  test('a saved answer comes back in the client shape', () => {
    expect(
      toSavedAnswer({
        question_id: 'q',
        option_id: null,
        text_answer: null,
        option_ids: ['a'],
        matches: { a: 'Red' },
        numeric_answer: '3.5',
        file_id: null,
      }),
    ).toEqual({
      questionId: 'q',
      optionId: null,
      text: null,
      optionIds: ['a'],
      matches: [{ optionId: 'a', label: 'Red' }],
      numeric: 3.5,
      fileId: null,
    });
  });
});
