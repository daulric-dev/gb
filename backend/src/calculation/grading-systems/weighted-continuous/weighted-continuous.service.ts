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
  simpleAverage,
  roundTwo,
} from '../../helpers/calculation.helpers';
import { computeGroupedTerm } from '../../helpers/grouped-term.helper';
import { WEIGHTED_CONTINUOUS_RULES } from './weighted-continuous.rules';

@Injectable()
export class WeightedContinuousService implements GradingSystemStrategy {
  readonly rules = WEIGHTED_CONTINUOUS_RULES;

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
   * Year-end: average term composites → CA block, combine with final exam.
   *
   * termsAvg = avg(T1_composite, T2_composite, T3_composite)
   * finalExam = last term's exam average
   * yearGrade = termsAvg x yearCW% + finalExam x yearExam%
   */
  calculateYearGrade(ctx: SubjectYearContext): number | null {
    const { termSubjectData, yearConfig } = ctx;

    const validComposites = termSubjectData
      .map((t) => t.termComposite)
      .filter((c): c is number => c !== null);

    const termsAvg = simpleAverage(validComposites);

    const lastTerm = termSubjectData[termSubjectData.length - 1];
    const finalExamAvg = lastTerm?.examAverage ?? null;

    if (termsAvg !== null && finalExamAvg !== null) {
      return roundTwo(
        (termsAvg * yearConfig.yearCourseworkWeight) / 100 +
          (finalExamAvg * yearConfig.yearExamWeight) / 100,
      );
    }

    if (termsAvg !== null) return termsAvg;
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
