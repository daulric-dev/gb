import { Injectable } from '@nestjs/common';
import type {
  GradingSystemStrategy,
  SubjectTermContext,
  SubjectYearContext,
} from '../../interfaces/grading-system.interface';
import type {
  SubjectGradeSummary,
} from '../../interfaces/calculation.interfaces';
import {
  calculateWeightedAverage,
  normalizeScore,
  roundTwo,
} from '../../helpers/calculation.helpers';
import { computeGroupedTerm } from '../../helpers/grouped-term.helper';
import { WEIGHTED_CUMULATIVE_RULES } from './weighted-cumulative.rules';

@Injectable()
export class WeightedCumulativeService implements GradingSystemStrategy {
  readonly rules = WEIGHTED_CUMULATIVE_RULES;

  /**
   * Per-term calculation is the same as continuous (CW + Exam weighted).
   * These per-term composites are kept for display but NOT used in the year formula.
   */
  /**
   * Term scoring is identical across the three models - they differ only in
   * how a year is aggregated - so it lives in one place.
   */
  calculateSubjectTermGrade(ctx: SubjectTermContext): SubjectGradeSummary {
    const { assessments, gradesByAssessmentId, groups } = ctx;

    if (assessments.length === 0) {
      return this.emptyResult(ctx);
    }

    const result = computeGroupedTerm(groups, assessments, gradesByAssessmentId);

    return {
      subjectId: ctx.subjectId,
      subjectName: ctx.subjectName,
      subjectCode: ctx.subjectCode,
      isGraded: true,
      courseworkAverage: result.courseworkAverage,
      examAverage: result.examAverage,
      termComposite: result.termComposite,
      groupAverages: result.groupAverages,
      gradeCount: result.gradeCount,
      assessments: result.assessments,
    };
  }

  /**
   * Year-end: pool ALL coursework from ALL terms into one weighted average.
   * Term boundaries are ignored - every coursework assessment across the year
   * feeds into one CA number.
   *
   * pooledCW = weightedAvg(all coursework assessments from all terms)
   * finalExam = last term's exam average
   * yearGrade = pooledCW x yearCW% + finalExam x yearExam%
   */
  calculateYearGrade(ctx: SubjectYearContext): number | null {
    const { allAssessments, gradeIndex, yearConfig } = ctx;

    const courseworkItems: { score: number; weight: number }[] = [];
    const examItems: { score: number; weight: number }[] = [];

    for (const a of allAssessments) {
      if (a.is_excluded) continue;
      if (a.subject_id !== ctx.subjectId) continue;

      const grade = gradeIndex.get(`${a.id}`);
      if (!grade || grade.score === null || grade.is_excluded) continue;

      const normalized = normalizeScore(grade.score, a.max_score);

      if (a.assessment_type === 'coursework') {
        courseworkItems.push({ score: normalized, weight: a.weight });
      } else {
        examItems.push({ score: normalized, weight: a.weight });
      }
    }

    const pooledCW = calculateWeightedAverage(courseworkItems);

    const lastTerm = ctx.termSubjectData[ctx.termSubjectData.length - 1];
    const finalExamAvg =
      examItems.length > 0
        ? calculateWeightedAverage(examItems)
        : (lastTerm?.examAverage ?? null);

    if (pooledCW !== null && finalExamAvg !== null) {
      return roundTwo(
        (pooledCW * yearConfig.yearCourseworkWeight) / 100 +
          (finalExamAvg * yearConfig.yearExamWeight) / 100,
      );
    }

    if (pooledCW !== null) return pooledCW;
    if (finalExamAvg !== null) return finalExamAvg;
    return null;
  }

  private emptyResult(ctx: SubjectTermContext): SubjectGradeSummary {
    return {
      subjectId: ctx.subjectId,
      subjectName: ctx.subjectName,
      subjectCode: ctx.subjectCode,
      isGraded: true,
      courseworkAverage: null,
      examAverage: null,
      termComposite: null,
      groupAverages: [],
      gradeCount: 0,
      assessments: [],
    };
  }
}
