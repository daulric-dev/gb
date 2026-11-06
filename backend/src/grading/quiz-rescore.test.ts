import { describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rescoreQuizFromAnswers } from './quiz-rescore';

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

async function rescoreSql(points: number, activityId: string) {
  const $executeRaw = mock(async (..._args: unknown[]) => 3);
  const n = await rescoreQuizFromAnswers({ $executeRaw } as never, activityId, points);
  const [strings, ...values] = $executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return { n, text: strings.join('$'), values };
}

describe('rescoreQuizFromAnswers', () => {
  test('one statement with the new points and the activity, returning the row count', async () => {
    const { n, values } = await rescoreSql(40, 'act-1');
    expect(n).toBe(3);
    expect(values).toEqual([40, 'act-1']);
  });

  test('scores exactly as the latest grading.submit_quiz does', async () => {
    const { folder, body } = latestSubmitQuiz();
    const fn = norm(body);
    const { text } = await rescoreSql(40, 'act-1');
    const ours = norm(text);

    // The per-question "right answer" test, word for word.
    const hit = fn.slice(fn.indexOf('select case when q.kind'), fn.indexOf('end as hit') + 'end as hit'.length);
    expect(hit.length).toBeGreaterThan(50);
    expect(ours).toContain(hit);
    // Possible and earned points over the quiz's questions.
    expect(fn).toContain('coalesce(sum(q.points), 0)');
    expect(fn).toContain('coalesce(sum(case when correct.hit then q.points else 0 end), 0)');
    expect(ours).toContain('coalesce(sum(q.points), 0) as possible');
    expect(ours).toContain('coalesce(sum(case when correct.hit then q.points else 0 end), 0) as earned');
    // earned / possible * points, 0 when the questions are worth nothing.
    expect(fn).toContain('when v_possible > 0 then (v_earned / v_possible) * v_activity.points else 0');
    expect(ours).toContain('when t.possible > 0 then (t.earned / t.possible) * $::numeric else 0');
    // Short answers: case-insensitive, trimmed.
    expect(ours).toContain('lower(btrim(ans.text_answer)) = lower(btrim(o.label))');
    expect(folder >= '20261108110000_quiz_lockdown_presence').toBe(true);
  });

  test('only automatic scores of finished attempts', async () => {
    const ours = norm((await rescoreSql(1, 'a')).text);
    expect(ours).toContain('s2.graded_by is null');
    expect(ours).toContain('s2.score is not null');
    expect(ours).toContain('s2.quiz_started_at is null');
  });
});
