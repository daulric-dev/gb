import type {
  AssessmentRecord,
  GradeRecord,
  GradingGroup,
} from '../interfaces/grading-system.interface';
import type {
  AssessmentGrade,
  GroupAverage,
} from '../interfaces/calculation.interfaces';
import {
  calculateWeightedAverage,
  normalizeScore,
  roundTwo,
} from './calculation.helpers';

export interface GroupedTermResult {
  assessments: AssessmentGrade[];
  groupAverages: GroupAverage[];
  /** Weighted sum across groups that have marks, renormalised to those groups. */
  termComposite: number | null;
  /** The continuous block: every group not flagged as the exam. */
  courseworkAverage: number | null;
  /** The exam block: the group flagged as the exam. */
  examAverage: number | null;
  gradeCount: number;
}

/**
 * Compute one subject's term figures from a scheme of N weighted groups.
 *
 * All three grading models share this: they differ only in how a *year* is
 * aggregated, not in how a term is scored. Assessment weights average within a
 * group; group weights combine the groups.
 *
 * Groups with no marks are dropped and the remainder renormalised, which keeps
 * the old behaviour of falling back to whichever bucket had data rather than
 * scoring a term out of a total nobody attempted. A scheme of 20/20/60 where
 * only the two 20s have marks is therefore scored out of 40, not 100.
 */
export function computeGroupedTerm(
  groups: GradingGroup[],
  assessments: AssessmentRecord[],
  gradesByAssessmentId: Map<string, GradeRecord>,
): GroupedTermResult {
  const assessmentGrades: AssessmentGrade[] = [];
  const itemsByGroup = new Map<string, { score: number; weight: number }[]>();
  let gradeCount = 0;

  // An assessment predating the scheme, or pointing at a deleted group, still
  // has to land somewhere: fall back to its old exam/coursework type.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const examGroup = groups.find((g) => g.isExam) ?? null;
  const firstNonExam = groups.find((g) => !g.isExam) ?? null;

  const resolveGroup = (a: AssessmentRecord): GradingGroup | null => {
    if (a.grading_group_id) {
      const direct = groupById.get(a.grading_group_id);
      if (direct) return direct;
    }
    return a.assessment_type === 'exam' ? examGroup : firstNonExam;
  };

  for (const a of assessments) {
    const grade = gradesByAssessmentId.get(a.id);
    const excluded = a.is_excluded || (grade?.is_excluded ?? false);
    const score = grade?.score ?? null;
    const percentage =
      score !== null && a.max_score > 0
        ? normalizeScore(score, a.max_score)
        : null;

    const group = resolveGroup(a);

    assessmentGrades.push({
      assessmentId: a.id,
      title: a.title,
      assessmentType: a.assessment_type,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      maxScore: a.max_score,
      weight: a.weight,
      score,
      percentage: percentage !== null ? roundTwo(percentage) : null,
      isExcluded: excluded,
      exclusionReason: excluded
        ? grade?.exclusion_reason ||
          (a.is_excluded ? 'Assessment excluded' : null)
        : null,
    });

    if (score !== null && !excluded && group) {
      gradeCount++;
      const bucket = itemsByGroup.get(group.id) ?? [];
      bucket.push({ score: normalizeScore(score, a.max_score), weight: a.weight });
      itemsByGroup.set(group.id, bucket);
    }
  }

  const groupAverages: GroupAverage[] = groups.map((g) => {
    const average = calculateWeightedAverage(itemsByGroup.get(g.id) ?? []);
    return {
      groupId: g.id,
      name: g.name,
      weight: g.weight,
      isExam: g.isExam,
      average: average !== null ? roundTwo(average) : null,
    };
  });

  const scored = groupAverages.filter((g) => g.average !== null);
  const weightWithMarks = scored.reduce((sum, g) => sum + g.weight, 0);

  const termComposite =
    scored.length > 0 && weightWithMarks > 0
      ? roundTwo(
          scored.reduce((sum, g) => sum + (g.average as number) * g.weight, 0) /
            weightWithMarks,
        )
      : null;

  // The two-way split the year-end formulas are built on.
  const continuous = scored.filter((g) => !g.isExam);
  const continuousWeight = continuous.reduce((sum, g) => sum + g.weight, 0);
  const courseworkAverage =
    continuous.length > 0 && continuousWeight > 0
      ? roundTwo(
          continuous.reduce(
            (sum, g) => sum + (g.average as number) * g.weight,
            0,
          ) / continuousWeight,
        )
      : null;

  const examAverage = scored.find((g) => g.isExam)?.average ?? null;

  return {
    assessments: assessmentGrades,
    groupAverages,
    termComposite,
    courseworkAverage,
    examAverage,
    gradeCount,
  };
}
