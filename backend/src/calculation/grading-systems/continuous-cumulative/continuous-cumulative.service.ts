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
  calculateSubjectTermGrade(ctx: SubjectTermContext): SubjectGradeSummary {
    const { assessments, gradesByAssessmentId } = ctx;

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
        const normalized = normalizeScore(score, a.max_score);
        if (a.assessment_type === 'coursework') {
          gradeCount++;
          courseworkItems.push({ score: normalized, weight: a.weight });
        } else {
          examItems.push({ score: normalized, weight: a.weight });
        }
      }
    }

    const courseworkAverage = calculateWeightedAverage(courseworkItems);
    const examAverage = calculateWeightedAverage(examItems);

    return {
      subjectId: ctx.subjectId,
      subjectName: ctx.subjectName,
      subjectCode: ctx.subjectCode,
      isGraded: true,
      courseworkAverage:
        courseworkAverage !== null ? roundTwo(courseworkAverage) : null,
      examAverage: examAverage !== null ? roundTwo(examAverage) : null,
      termComposite:
        courseworkAverage !== null ? roundTwo(courseworkAverage) : null,
      gradeCount,
      assessments: assessmentGrades,
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
      gradeCount: 0,
      assessments: [],
    };
  }
}
