import { describe, test, expect, beforeEach } from 'bun:test';
import { CalculationService } from './calculation.service';
import { GradingSystemFactory } from './grading-systems/grading-system.factory';
import { WeightedContinuousService } from './grading-systems/weighted-continuous';
import { WeightedCumulativeService } from './grading-systems/weighted-cumulative';
import { ContinuousCumulativeService } from './grading-systems/continuous-cumulative';
import {
  createMockSupabaseService,
  createMockCacheService,
} from '@/test/mocks';

function createFactory() {
  const wc = new WeightedContinuousService();
  const wcum = new WeightedCumulativeService();
  const cc = new ContinuousCumulativeService();
  return new GradingSystemFactory(wc, wcum, cc);
}

describe('CalculationService', () => {
  let service: CalculationService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    mockCache = createMockCacheService();
    service = new CalculationService(
      mockSupabase as any,
      mockCache as any,
      createFactory(),
    );
  });

  describe('calculateClassTermResults', () => {
    test('returns cached data on cache hit', async () => {
      const cachedResults = [
        {
          studentId: 'stu1',
          firstName: 'A',
          lastName: 'B',
          termId: 't1',
          subjects: [],
          overallAverage: 85,
        },
      ];
      await mockCache.set('calc:class-term:sg1:t1', cachedResults, 3600);

      const result = await service.calculateClassTermResults('t1', 'sg1');
      expect(result).toEqual(cachedResults);
    });
  });

  describe('calculateClassYearResults', () => {
    test('returns cached data on cache hit', async () => {
      const cachedResults = [
        {
          studentId: 'stu1',
          firstName: 'A',
          lastName: 'B',
          academicYearId: 'y1',
          gradingModel: 'weighted_continuous' as const,
          terms: [],
          yearEnd: { subjects: [], overallAverage: 90 },
        },
      ];
      await mockCache.set('calc:class-year:sg1:y1', cachedResults, 3600);

      const result = await service.calculateClassYearResults('y1', 'sg1');
      expect(result).toEqual(cachedResults);
    });
  });
});

describe('WeightedContinuousService', () => {
  const strategy = new WeightedContinuousService();

  test('computes term grade with coursework and exam', () => {
    const result = strategy.calculateSubjectTermGrade({
      studentId: 'stu1',
      subjectId: 's1',
      subjectName: 'Math',
      subjectCode: 'MTH',
      termId: 't1',
      termWeights: { courseworkWeight: 40, examWeight: 60 },
      assessments: [
        {
          id: 'a1',
          title: 'HW1',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't1',
        },
        {
          id: 'a2',
          title: 'Exam',
          assessment_type: 'exam',
          max_score: 50,
          weight: 2,
          is_excluded: false,
          sort_order: 1,
          subject_id: 's1',
          term_id: 't1',
        },
      ],
      gradesByAssessmentId: new Map([
        [
          'a1',
          {
            id: 'g1',
            assessment_id: 'a1',
            student_id: 'stu1',
            score: 80,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a2',
          {
            id: 'g2',
            assessment_id: 'a2',
            student_id: 'stu1',
            score: 40,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
      ]),
    });

    expect(result.subjectId).toBe('s1');
    expect(result.isGraded).toBe(true);
    expect(result.gradeCount).toBe(2);
    expect(result.courseworkAverage).toBe(80);
    expect(result.examAverage).toBe(80);
    expect(result.termComposite).toBe(80);
    expect(result.assessments).toHaveLength(2);
  });

  test('returns empty result when no assessments', () => {
    const result = strategy.calculateSubjectTermGrade({
      studentId: 'stu1',
      subjectId: 's1',
      subjectName: 'Math',
      subjectCode: 'MTH',
      termId: 't1',
      termWeights: { courseworkWeight: 40, examWeight: 60 },
      assessments: [],
      gradesByAssessmentId: new Map(),
    });

    expect(result.courseworkAverage).toBeNull();
    expect(result.examAverage).toBeNull();
    expect(result.termComposite).toBeNull();
    expect(result.gradeCount).toBe(0);
  });

  test('computes year grade by averaging term composites', () => {
    const yearGrade = strategy.calculateYearGrade({
      subjectId: 's1',
      subjectName: 'Math',
      yearConfig: { yearCourseworkWeight: 40, yearExamWeight: 60 },
      termSubjectData: [
        {
          termId: 't1',
          termName: 'T1',
          termComposite: 75,
          courseworkAverage: 70,
          examAverage: 78,
          assessments: [],
        },
        {
          termId: 't2',
          termName: 'T2',
          termComposite: 80,
          courseworkAverage: 75,
          examAverage: 83,
          assessments: [],
        },
        {
          termId: 't3',
          termName: 'T3',
          termComposite: 72,
          courseworkAverage: 68,
          examAverage: 82,
          assessments: [],
        },
      ],
      allAssessments: [],
      gradeIndex: new Map(),
    });

    // termsAvg = (75+80+72)/3 = 75.67, finalExam = 82
    // year = 75.67 * 0.4 + 82 * 0.6 = 30.27 + 49.2 = 79.47
    expect(yearGrade).toBe(79.47);
  });
});

describe('WeightedCumulativeService', () => {
  const strategy = new WeightedCumulativeService();

  test('pools all coursework across terms for year grade', () => {
    const yearGrade = strategy.calculateYearGrade({
      subjectId: 's1',
      subjectName: 'Math',
      yearConfig: { yearCourseworkWeight: 40, yearExamWeight: 60 },
      termSubjectData: [
        {
          termId: 't1',
          termName: 'T1',
          termComposite: 75,
          courseworkAverage: 70,
          examAverage: 78,
          assessments: [],
        },
        {
          termId: 't2',
          termName: 'T2',
          termComposite: 80,
          courseworkAverage: 75,
          examAverage: null,
          assessments: [],
        },
        {
          termId: 't3',
          termName: 'T3',
          termComposite: 72,
          courseworkAverage: 68,
          examAverage: 82,
          assessments: [],
        },
      ],
      allAssessments: [
        {
          id: 'a1',
          title: 'HW1',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't1',
        },
        {
          id: 'a2',
          title: 'HW2',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't2',
        },
        {
          id: 'a3',
          title: 'HW3',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't3',
        },
        {
          id: 'a4',
          title: 'Final',
          assessment_type: 'exam',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't3',
        },
      ],
      gradeIndex: new Map([
        [
          'a1',
          {
            id: 'g1',
            assessment_id: 'a1',
            student_id: 'stu1',
            score: 70,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a2',
          {
            id: 'g2',
            assessment_id: 'a2',
            student_id: 'stu1',
            score: 80,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a3',
          {
            id: 'g3',
            assessment_id: 'a3',
            student_id: 'stu1',
            score: 75,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a4',
          {
            id: 'g4',
            assessment_id: 'a4',
            student_id: 'stu1',
            score: 85,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
      ]),
    });

    // pooledCW = (70+80+75)/3 = 75, finalExam = 85
    // year = 75 * 0.4 + 85 * 0.6 = 30 + 51 = 81
    expect(yearGrade).toBe(81);
  });
});

describe('ContinuousCumulativeService', () => {
  const strategy = new ContinuousCumulativeService();

  test('term grade uses only coursework (no exam)', () => {
    const result = strategy.calculateSubjectTermGrade({
      studentId: 'stu1',
      subjectId: 's1',
      subjectName: 'Math',
      subjectCode: 'MTH',
      termId: 't1',
      termWeights: { courseworkWeight: 100, examWeight: 0 },
      assessments: [
        {
          id: 'a1',
          title: 'HW1',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't1',
        },
        {
          id: 'a2',
          title: 'HW2',
          assessment_type: 'coursework',
          max_score: 50,
          weight: 1,
          is_excluded: false,
          sort_order: 1,
          subject_id: 's1',
          term_id: 't1',
        },
      ],
      gradesByAssessmentId: new Map([
        [
          'a1',
          {
            id: 'g1',
            assessment_id: 'a1',
            student_id: 'stu1',
            score: 80,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a2',
          {
            id: 'g2',
            assessment_id: 'a2',
            student_id: 'stu1',
            score: 40,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
      ]),
    });

    expect(result.examAverage).toBeNull();
    // CW: 80/100=80%, 40/50=80% -> avg = 80
    expect(result.courseworkAverage).toBe(80);
    expect(result.termComposite).toBe(80);
  });

  test('year grade combines all CW from all terms + final exam', () => {
    const yearGrade = strategy.calculateYearGrade({
      subjectId: 's1',
      subjectName: 'Math',
      yearConfig: { yearCourseworkWeight: 40, yearExamWeight: 60 },
      termSubjectData: [
        {
          termId: 't1',
          termName: 'T1',
          termComposite: 80,
          courseworkAverage: 80,
          examAverage: null,
          assessments: [],
        },
        {
          termId: 't2',
          termName: 'T2',
          termComposite: 70,
          courseworkAverage: 70,
          examAverage: null,
          assessments: [],
        },
        {
          termId: 't3',
          termName: 'T3',
          termComposite: 75,
          courseworkAverage: 75,
          examAverage: null,
          assessments: [],
        },
      ],
      allAssessments: [
        {
          id: 'a1',
          title: 'HW1',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't1',
        },
        {
          id: 'a2',
          title: 'HW2',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't2',
        },
        {
          id: 'a3',
          title: 'HW3',
          assessment_type: 'coursework',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't3',
        },
        {
          id: 'a4',
          title: 'Final Exam',
          assessment_type: 'exam',
          max_score: 100,
          weight: 1,
          is_excluded: false,
          sort_order: 0,
          subject_id: 's1',
          term_id: 't3',
        },
      ],
      gradeIndex: new Map([
        [
          'a1',
          {
            id: 'g1',
            assessment_id: 'a1',
            student_id: 'stu1',
            score: 80,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a2',
          {
            id: 'g2',
            assessment_id: 'a2',
            student_id: 'stu1',
            score: 70,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a3',
          {
            id: 'g3',
            assessment_id: 'a3',
            student_id: 'stu1',
            score: 75,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        [
          'a4',
          {
            id: 'g4',
            assessment_id: 'a4',
            student_id: 'stu1',
            score: 90,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
      ]),
    });

    // combinedCW = (80+70+75)/3 = 75, finalExam = 90
    // year = 75 * 0.4 + 90 * 0.6 = 30 + 54 = 84
    expect(yearGrade).toBe(84);
  });
});
