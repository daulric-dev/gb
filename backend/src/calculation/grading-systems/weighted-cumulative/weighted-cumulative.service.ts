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
  roundTwo,
} from '../../helpers/calculation.helpers';
import { WEIGHTED_CUMULATIVE_RULES } from './weighted-cumulative.rules';

@Injectable()
export class WeightedCumulativeService implements GradingSystemStrategy {
  readonly rules = WEIGHTED_CUMULATIVE_RULES;

  /**
   * Per-term calculation is the same as continuous (CW + Exam weighted).
   * These per-term composites are kept for display but NOT used in the year formula.
   */
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
      gradeCount: 0,
      assessments: [],
    };
  }
}
