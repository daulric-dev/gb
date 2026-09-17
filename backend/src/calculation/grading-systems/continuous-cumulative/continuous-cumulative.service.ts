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
import { CONTINUOUS_CUMULATIVE_RULES } from './continuous-cumulative.rules';

@Injectable()
export class ContinuousCumulativeService implements GradingSystemStrategy {
  readonly rules = CONTINUOUS_CUMULATIVE_RULES;

  /**
   * Per-term: coursework only (no per-term exam).
   * The term composite IS the coursework average since there's no exam component.
   * Any exam assessments entered in non-final terms are still processed but
   * won't factor into the term composite under this system.
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
   * Year-end: combine all coursework from all terms → CA block + final exam.
   *
   * The final exam lives in the last term as exam-type assessments.
   * combinedCW = weightedAvg(all coursework assessments from all terms)
   * finalExam = weightedAvg(exam assessments from the last term)
   * yearGrade = combinedCW x yearCW% + finalExam x yearExam%
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

    const combinedCW = calculateWeightedAverage(courseworkItems);
    const finalExam = calculateWeightedAverage(examItems);

    if (combinedCW !== null && finalExam !== null) {
      return roundTwo(
        (combinedCW * yearConfig.yearCourseworkWeight) / 100 +
          (finalExam * yearConfig.yearExamWeight) / 100,
      );
    }

    if (combinedCW !== null) return combinedCW;
    if (finalExam !== null) return finalExam;
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
