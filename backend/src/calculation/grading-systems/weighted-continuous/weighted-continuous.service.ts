import { Injectable } from '@nestjs/common';
import type {
  GradingSystemStrategy,
  SubjectTermContext,
  SubjectYearContext,
} from '../../interfaces/grading-system.interface';
import type {
  SubjectGradeSummary,
  AssessmentGrade,
} from '../../interfaces/calculation.interfaces';
import {
  calculateWeightedAverage,
  normalizeScore,
  simpleAverage,
  roundTwo,
} from '../../helpers/calculation.helpers';
import { WEIGHTED_CONTINUOUS_RULES } from './weighted-continuous.rules';

@Injectable()
export class WeightedContinuousService implements GradingSystemStrategy {
  readonly rules = WEIGHTED_CONTINUOUS_RULES;

  calculateSubjectTermGrade(ctx: SubjectTermContext): SubjectGradeSummary {
    const { assessments, gradesByAssessmentId, termWeights } = ctx;

    if (assessments.length === 0) {
      return this.emptyResult(ctx);
    }

    const assessmentGrades: AssessmentGrade[] = [];
    const courseworkItems: { score: number; weight: number }[] = [];
    const examItems: { score: number; weight: number }[] = [];
    let gradeCount = 0;

    for (const a of assessments) {
      const grade = gradesByAssessmentId.get(a.id);
      const assessmentExcluded = a.is_excluded;
      const gradeExcluded = grade?.is_excluded ?? false;
      const excluded = assessmentExcluded || gradeExcluded;

      const score = grade?.score ?? null;
      const percentage =
        score !== null && a.max_score > 0
          ? normalizeScore(score, a.max_score)
          : null;

      assessmentGrades.push({
        assessmentId: a.id,
        title: a.title,
        assessmentType: a.assessment_type,
        maxScore: a.max_score,
        weight: a.weight,
        score,
        percentage: percentage !== null ? roundTwo(percentage) : null,
        isExcluded: excluded,
        exclusionReason: excluded
          ? grade?.exclusion_reason ||
            (assessmentExcluded ? 'Assessment excluded' : null)
          : null,
      });

      if (score !== null && !excluded) {
        gradeCount++;
        const normalized = normalizeScore(score, a.max_score);

        if (a.assessment_type === 'coursework') {
          courseworkItems.push({ score: normalized, weight: a.weight });
        } else {
          examItems.push({ score: normalized, weight: a.weight });
        }
      }
    }

    const courseworkAverage = calculateWeightedAverage(courseworkItems);
    const examAverage = calculateWeightedAverage(examItems);

    const cwWeight = termWeights.courseworkWeight;
    const exWeight = termWeights.examWeight;

    let termComposite: number | null = null;
    if (courseworkAverage !== null && examAverage !== null) {
      termComposite = roundTwo(
        (courseworkAverage * cwWeight) / 100 + (examAverage * exWeight) / 100,
      );
    } else if (courseworkAverage !== null) {
      termComposite = courseworkAverage;
    } else if (examAverage !== null) {
      termComposite = examAverage;
    }

    return {
      subjectId: ctx.subjectId,
      subjectName: ctx.subjectName,
      subjectCode: ctx.subjectCode,
      isGraded: true,
      courseworkAverage:
        courseworkAverage !== null ? roundTwo(courseworkAverage) : null,
      examAverage: examAverage !== null ? roundTwo(examAverage) : null,
      termComposite,
      gradeCount,
      assessments: assessmentGrades,
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
      gradeCount: 0,
      assessments: [],
    };
  }
}
