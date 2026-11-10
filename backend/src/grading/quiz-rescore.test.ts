import { describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIZ_CREDIT, rescoreQuizFromAnswers, rescoreSql } from './quiz-rescore';

const MIGRATIONS = join(__dirname, '../../prisma/migrations');

/** The newest migration that (re)defines grading.submit_quiz, and that definition. */
function latestSubmitQuiz(): { folder: string; body: string } {
  const folders = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const folder of folders.reverse()) {
    const text = readFileSync(join(MIGRATIONS, folder, 'migration.sql'), 'utf8');
    const start = text.search(/FUNCTION grading\.submit_quiz\(/i);
    if (start < 0) continue;
    const end = text.indexOf('$$;', start);
    return { folder, body: text.slice(start, end) };
  }
  throw new Error('grading.submit_quiz not found in the migrations');
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

describe('rescoreQuizFromAnswers', () => {
  test('one statement with the points, the activity and the submission, returning the row count', async () => {
    const $executeRaw = mock(async (..._args: unknown[]) => 3);
    const n = await rescoreQuizFromAnswers({ $executeRaw } as never, 'act-1', 40, 'sub-1');
    expect(n).toBe(3);
    const sql = $executeRaw.mock.calls[0][0] as ReturnType<typeof rescoreSql>;
    expect(sql.values).toEqual([40, 40, 'act-1', 'sub-1', 'sub-1']);
  });

  test('scores exactly as the latest grading.submit_quiz does', () => {
    const { folder, body } = latestSubmitQuiz();
    const fn = norm(body);
    const ours = norm(rescoreSql('a', 40).sql);
    const credit = norm(QUIZ_CREDIT.sql);

    // The per-question credit, word for word: in the function and in ours.
    const start = fn.indexOf('left join lateral (') + 'left join lateral ('.length;
    const end = fn.indexOf(') correct on true');
    expect(fn.slice(start, end).trim()).toBe(credit);
    expect(ours).toContain(credit);
    // Possible and earned points, and the unmarked count.
    expect(fn).toContain('coalesce(sum(q.points), 0)');
    expect(fn).toContain('coalesce(sum(q.points * correct.credit), 0)');
    expect(fn).toContain('count(*) filter (where correct.unmarked)');
    expect(ours).toContain('coalesce(sum(q.points), 0) as possible');
    expect(ours).toContain('coalesce(sum(q.points * correct.credit), 0) as earned');
    expect(ours).toContain('count(*) filter (where correct.unmarked) as unmarked');
    // earned / possible * points, 0 when the questions are worth nothing.
    expect(fn).toContain('when v_possible > 0 then (v_earned / v_possible) * v_activity.points else 0');
    expect(ours).toContain('when t.possible > 0 then (t.earned / t.possible) * ?::numeric else 0');
    // The same question set: the attempt's own, else the quiz's.
    expect(fn).toContain(
      norm(
        'q.id in ( select aq.question_id from grading.quiz_attempt_question aq where aq.submission_id = p_submission_id ) or (q.activity_id = v_activity.id and not exists ( select 1 from grading.quiz_attempt_question aq where aq.submission_id = p_submission_id ))',
      ),
    );
    expect(ours).toContain(
      norm(
        'on q.id in ( select aq.question_id from grading.quiz_attempt_question aq where aq.submission_id = s2.id ) or (q.activity_id = s2.activity_id and not exists ( select 1 from grading.quiz_attempt_question aq where aq.submission_id = s2.id ))',
      ),
    );
    // Needs marking while any answered essay or file question is unmarked.
    expect(fn).toContain("when v_unmarked > 0 then 'submitted'::grading.submission_status");
    expect(ours).toContain("when t.unmarked > 0 then 'submitted'::grading.submission_status");
    expect(folder >= '20261117100000_quiz_question_types').toBe(true);
  });

  test('every question kind is scored in the SQL', () => {
    const credit = norm(QUIZ_CREDIT.sql);
    for (const kind of [
      'short_answer',
      "'multiple_choice', 'true_false'",
      'numeric',
      'multiple_select',
      'matching',
      'ordering',
      "'essay', 'file_upload'",
    ]) {
      expect(credit).toContain(kind);
    }
    expect(credit).toContain('abs(ans.numeric_answer - q.numeric_answer) <= q.numeric_tolerance');
    expect(credit).toContain('lower(btrim(ans.text_answer)) = lower(btrim(o.label))');
  });

  test('only automatic scores of finished attempts', () => {
    const ours = norm(rescoreSql('a', 1).sql);
    expect(ours).toContain('s2.graded_by is null');
    expect(ours).toContain('s2.score is not null');
    expect(ours).toContain('s2.quiz_started_at is null');
  });
});
