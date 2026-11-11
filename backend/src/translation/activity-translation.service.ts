import { Injectable } from '@nestjs/common';
import { ActivityService, type ActivityCopyText } from '@/grading/activity.service';
import { AUTO } from './translation-engine';
import { languageName } from './translation.constants';
import { requireLanguage, TranslationService } from './translation.service';
import type { TranslateActivityDto } from './translation.dto';

/**
 * `POST /courses/:courseId/activities/:activityId/translate`: a new draft
 * copy of an assignment, quiz or offline activity with its text
 * machine-translated (title, instructions, question prompts, option labels
 * and matching answers) and the language added to the title in brackets.
 * Course teachers and admins (MANAGE_ROLES, checked by ActivityService
 * before anything is sent); `translation` must be on for the course's
 * school. The copy is made by ActivityService.createCopy: never
 * submissions or marks.
 */
@Injectable()
export class ActivityTranslationService {
  constructor(
    private readonly activities: ActivityService,
    private readonly translation: TranslationService,
  ) {}

  async translate(userId: string, courseId: string, activityId: string, dto: TranslateActivityDto) {
    const to = requireLanguage(dto.to, 'to');
    const source = await this.activities.sourceForCopy(userId, courseId, activityId);
    const cfg = await this.translation.requireConfig(source.activity.school_id);

    // Every text, flattened in a fixed order, then read back in that order.
    const texts: string[] = [source.activity.title, source.activity.instructions ?? ''];
    for (const q of source.questions) {
      texts.push(q.prompt);
      for (const o of q.quiz_option) texts.push(o.label, o.match_label ?? '');
    }
    // No `from`: course content may be in any language.
    const out = await this.translation.translateWith(cfg, texts, AUTO, to);

    let i = 0;
    const next = () => out[i++];
    const title = next();
    const instructions = next();
    const questions: ActivityCopyText['questions'] = source.questions.map((q) => ({
      prompt: next(),
      options: q.quiz_option.map(() => ({ label: next(), matchLabel: next() || null })),
    }));

    const suffix = ` [${languageName(to)}]`;
    const base = (title.trim() || source.activity.title).slice(0, Math.max(1, 200 - suffix.length));
    return this.activities.createCopy(userId, source, {
      title: `${base}${suffix}`,
      instructions: source.activity.instructions === null ? null : instructions,
      questions,
    });
  }
}
