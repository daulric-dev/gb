import { describe, test, expect, beforeEach } from 'bun:test';
import { CalculationService } from './calculation.service';
import {
  createMockSupabaseService,
  createMockCacheService,
  createMockQueryBuilder,
} from '@/test/mocks';

describe('CalculationService', () => {
  let service: CalculationService;
  let mockSupabase: ReturnType<typeof createMockSupabaseService>;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseService();
    mockCache = createMockCacheService();
    service = new CalculationService(mockSupabase as any, mockCache as any);
  });

  describe('calculateSubjectTermGrade', () => {
    test('computes weighted averages from assessments and grades', async () => {
      const subjectResult = {
        data: { id: 's1', name: 'Math', code: 'MTH', is_graded: true },
        error: null,
      };
      const assessmentsResult = {
        data: [
          {
            id: 'a1',
            title: 'HW1',
            assessment_type: 'coursework',
            max_score: 100,
            weight: 1,
            is_excluded: false,
            sort_order: 0,
          },
          {
            id: 'a2',
            title: 'Exam',
            assessment_type: 'exam',
            max_score: 50,
            weight: 2,
            is_excluded: false,
            sort_order: 1,
          },
        ],
        error: null,
      };
      const gradesResult = {
        data: [
          {
            id: 'g1',
            assessment_id: 'a1',
            score: 80,
            is_excluded: false,
            exclusion_reason: null,
          },
          {
            id: 'g2',
            assessment_id: 'a2',
            score: 40,
            is_excluded: false,
            exclusion_reason: null,
          },
        ],
        error: null,
      };
      const termResult = {
        data: { coursework_weight: 40, exam_weight: 60 },
        error: null,
      };

      let callIndex = 0;
      const results = [
        subjectResult,
        assessmentsResult,
        gradesResult,
        termResult,
      ];
      const builder = createMockQueryBuilder(results[0]);

      builder.single = () => {
        const r = results[callIndex];
        callIndex++;
        return Promise.resolve(r);
      };
      builder.then = (resolve: Function) => {
        const r = results[callIndex];
        callIndex++;
        return resolve(r);
      };

      mockSupabase.getServiceClient = () =>
        ({
          from: () => builder,
          schema: () => ({ from: () => builder }),
        }) as any;

      const result = await service.calculateSubjectTermGrade(
        'stu1',
        's1',
        't1',
      );

      expect(result.subjectId).toBe('s1');
      expect(result.subjectName).toBe('Math');
      expect(result.isGraded).toBe(true);
      expect(result.gradeCount).toBe(2);
      expect(result.courseworkAverage).toBe(80);
      expect(result.examAverage).toBe(80);
      expect(result.termComposite).toBe(80);
      expect(result.assessments).toHaveLength(2);
    });

    test('returns null averages when no grades exist', async () => {
      const subjectResult = {
        data: { id: 's1', name: 'Math', code: 'MTH', is_graded: true },
        error: null,
      };
      const assessmentsResult = { data: [], error: null };

      let callIndex = 0;
      const results = [subjectResult, assessmentsResult];
      const builder = createMockQueryBuilder(results[0]);

      builder.single = () => {
        const r = results[callIndex];
        callIndex++;
        return Promise.resolve(r);
      };
      builder.then = (resolve: Function) => {
        const r = results[callIndex];
        callIndex++;
        return resolve(r);
      };

      mockSupabase.getServiceClient = () =>
        ({
          from: () => builder,
          schema: () => ({ from: () => builder }),
        }) as any;

      const result = await service.calculateSubjectTermGrade(
        'stu1',
        's1',
        't1',
      );

      expect(result.courseworkAverage).toBeNull();
      expect(result.examAverage).toBeNull();
      expect(result.termComposite).toBeNull();
      expect(result.gradeCount).toBe(0);
      expect(result.assessments).toEqual([]);
    });
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
          gradingModel: 'term_based' as const,
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
