import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { SubjectGradeSummary, AssessmentGrade, StudentTermResult, StudentYearResult, YearEndSubject } from './interfaces/calculation.interfaces'; 

@Injectable()
export class CalculationService {
  private readonly logger = new Logger(CalculationService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private calculateWeightedAverage(
    items: { score: number; weight: number }[],
  ): number | null {
    if (items.length === 0) return null;

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight === 0) return null;

    const weightedSum = items.reduce(
      (sum, item) => sum + item.score * item.weight,
      0,
    );

    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }

  private normalizeScore(score: number, maxScore: number): number {
    if (maxScore === 0) return 0;
    return (score / maxScore) * 100;
  }

  private simpleAverage(values: number[]): number | null {
    if (values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round((sum / values.length) * 100) / 100;
  }

  async calculateSubjectTermGrade(studentId: string, subjectId: string, termId: string): Promise<SubjectGradeSummary> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: subject } = await supabase
      .from('subject')
      .select('id, name, code, is_graded')
      .eq('id', subjectId)
      .single();

    const subjectName = subject?.name ?? 'Unknown';
    const subjectCode = subject?.code ?? null;
    const isGraded = subject?.is_graded ?? true;

    if (!isGraded) {
      return {
        subjectId,
        subjectName,
        subjectCode,
        isGraded: false,
        courseworkAverage: null,
        examAverage: null,
        termComposite: null,
        gradeCount: 0,
        assessments: [],
      };
    }

    const { data: assessments, error: assessmentError } = await supabase
      .schema('grading')
      .from('assessment')
      .select('id, title, assessment_type, max_score, weight, is_excluded, sort_order')
      .eq('term_id', termId)
      .eq('subject_id', subjectId)
      .order('sort_order', { ascending: true });

    if (assessmentError) {
      this.logger.error(`Failed to fetch assessments: ${assessmentError.message}`);
      return {
        subjectId, subjectName, subjectCode, isGraded: true,
        courseworkAverage: null, examAverage: null, termComposite: null,
        gradeCount: 0, assessments: [],
      };
    }

    if (!assessments?.length) {
      return {
        subjectId, subjectName, subjectCode, isGraded: true,
        courseworkAverage: null, examAverage: null, termComposite: null,
        gradeCount: 0, assessments: [],
      };
    }

    const assessmentIds = assessments.map((a: any) => a.id);

    const { data: grades } = await supabase
      .schema('grading')
      .from('grade')
      .select('id, assessment_id, score, is_excluded, exclusion_reason')
      .eq('student_id', studentId)
      .in('assessment_id', assessmentIds);

    const gradeMap = new Map<string, any>();
    for (const g of grades ?? []) {
      gradeMap.set(g.assessment_id, g);
    }

    const assessmentGrades: AssessmentGrade[] = [];
    const courseworkItems: { score: number; weight: number }[] = [];
    const examItems: { score: number; weight: number }[] = [];
    let gradeCount = 0;

    for (const a of assessments) {
      const grade = gradeMap.get(a.id);
      const assessmentExcluded = a.is_excluded;
      const gradeExcluded = grade?.is_excluded ?? false;
      const excluded = assessmentExcluded || gradeExcluded;

      const score = grade?.score ?? null;
      const percentage = score !== null && a.max_score > 0
        ? this.normalizeScore(score, a.max_score)
        : null;

      assessmentGrades.push({
        assessmentId: a.id,
        title: a.title,
        assessmentType: a.assessment_type,
        maxScore: a.max_score,
        weight: a.weight,
        score,
        percentage: percentage !== null ? Math.round(percentage * 100) / 100 : null,
        isExcluded: excluded,
        exclusionReason: excluded
          ? (grade?.exclusion_reason || (assessmentExcluded ? 'Assessment excluded' : null))
          : null,
      });

      if (score !== null && !excluded) {
        gradeCount++;
        const normalized = this.normalizeScore(score, a.max_score);

        if (a.assessment_type === 'coursework') {
          courseworkItems.push({ score: normalized, weight: a.weight });
        } else {
          examItems.push({ score: normalized, weight: a.weight });
        }
      }
    }

    const courseworkAverage = this.calculateWeightedAverage(courseworkItems);
    const examAverage = this.calculateWeightedAverage(examItems);

    const { data: term } = await supabase
      .from('term')
      .select('coursework_weight, exam_weight')
      .eq('id', termId)
      .single();

    const cwWeight = term?.coursework_weight ?? 50;
    const exWeight = term?.exam_weight ?? 50;

    let termComposite: number | null = null;
    if (courseworkAverage !== null && examAverage !== null) {
      termComposite = (courseworkAverage * cwWeight / 100) + (examAverage * exWeight / 100);
      termComposite = Math.round(termComposite * 100) / 100;
    } else if (courseworkAverage !== null) {
      termComposite = courseworkAverage;
    } else if (examAverage !== null) {
      termComposite = examAverage;
    }

    return {
      subjectId,
      subjectName,
      subjectCode,
      isGraded: true,
      courseworkAverage: courseworkAverage !== null ? Math.round(courseworkAverage * 100) / 100 : null,
      examAverage: examAverage !== null ? Math.round(examAverage * 100) / 100 : null,
      termComposite,
      gradeCount,
      assessments: assessmentGrades,
    };
  }

  async calculateStudentTermResult(studentId: string, termId: string, studentGroupId: string): Promise<StudentTermResult> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: student } = await supabase
      .schema('student')
      .from('student')
      .select('id, first_name, last_name')
      .eq('id', studentId)
      .single();

    if (!student) {
      this.logger.error(`Student not found: ${studentId}`);
      return {
        studentId,
        firstName: 'Unknown',
        lastName: 'Unknown',
        termId,
        subjects: [],
        overallAverage: null,
      };
    }

    const { data: group } = await supabase
      .from('student_group')
      .select('academic_year_id')
      .eq('id', studentGroupId)
      .single();

    const academicYearId = group?.academic_year_id;
    if (!academicYearId) {
      this.logger.error(`Student group not found or missing academic year: ${studentGroupId}`);
      return {
        studentId,
        firstName: student.first_name,
        lastName: student.last_name,
        termId,
        subjects: [],
        overallAverage: null,
      };
    }

    const { data: subjectProfiles } = await supabase
      .schema('student')
      .from('student_subject_profile')
      .select('subject_id')
      .eq('student_id', studentId)
      .eq('academic_year_id', academicYearId);

    const subjectIds = (subjectProfiles ?? []).map((sp: any) => sp.subject_id);

    if (subjectIds.length === 0) {
      return {
        studentId,
        firstName: student.first_name,
        lastName: student.last_name,
        termId,
        subjects: [],
        overallAverage: null,
      };
    }

    const { data: subjects } = await supabase
      .from('subject')
      .select('id, name, code, is_graded, sort_order')
      .in('id', subjectIds)
      .order('sort_order', { ascending: true });

    const subjectResults: SubjectGradeSummary[] = [];

    for (const subj of subjects ?? []) {
      if (!subj.is_graded) {
        subjectResults.push({
          subjectId: subj.id,
          subjectName: subj.name,
          subjectCode: subj.code,
          isGraded: false,
          courseworkAverage: null,
          examAverage: null,
          termComposite: null,
          gradeCount: 0,
          assessments: [],
        });
        continue;
      }

      const result = await this.calculateSubjectTermGrade(studentId, subj.id, termId);
      subjectResults.push(result);
    }

    const gradedComposites = subjectResults
      .filter((s) => s.isGraded && s.termComposite !== null)
      .map((s) => s.termComposite!);

    const overallAverage = this.simpleAverage(gradedComposites);

    return {
      studentId,
      firstName: student.first_name,
      lastName: student.last_name,
      termId,
      subjects: subjectResults,
      overallAverage,
    };
  }

  async calculateStudentYearResult(studentId: string, academicYearId: string, studentGroupId: string): Promise<StudentYearResult> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: student } = await supabase
      .schema('student')
      .from('student')
      .select('id, first_name, last_name')
      .eq('id', studentId)
      .single();

    const firstName = student?.first_name ?? 'Unknown';
    const lastName = student?.last_name ?? 'Unknown';

    const { data: academicYear } = await supabase
      .from('academic_year')
      .select('id, grading_model, year_exam_weight, year_coursework_weight')
      .eq('id', academicYearId)
      .single();

    const gradingModel = academicYear?.grading_model ?? 'term_based';
    const yearExamWeight = academicYear?.year_exam_weight ?? 50;
    const yearCourseworkWeight = academicYear?.year_coursework_weight ?? 50;

    const { data: terms } = await supabase
      .from('term')
      .select('id, name, sort_order')
      .eq('academic_year_id', academicYearId)
      .order('sort_order', { ascending: true });

    if (!terms?.length) {
      return {
        studentId, firstName, lastName, academicYearId, gradingModel,
        terms: [],
        yearEnd: { subjects: [], overallAverage: null },
      };
    }

    const termResults: {
      termId: string;
      termName: string;
      subjects: SubjectGradeSummary[];
      overallAverage: number | null;
    }[] = [];

    for (const term of terms) {
      const result = await this.calculateStudentTermResult(studentId, term.id, studentGroupId);
      termResults.push({
        termId: term.id,
        termName: term.name,
        subjects: result.subjects,
        overallAverage: result.overallAverage,
      });
    }

    const allSubjectIds = new Set<string>();
    for (const tr of termResults) {
      for (const s of tr.subjects) {
        if (s.isGraded) allSubjectIds.add(s.subjectId);
      }
    }

    const yearEndSubjects: YearEndSubject[] = [];

    for (const subjectId of allSubjectIds) {
      const termGrades: { termId: string; termName: string; termComposite: number | null }[] = [];
      let subjectName = '';

      for (const tr of termResults) {
        const subj = tr.subjects.find((s) => s.subjectId === subjectId);
        if (subj) subjectName = subj.subjectName;
        termGrades.push({
          termId: tr.termId,
          termName: tr.termName,
          termComposite: subj?.termComposite ?? null,
        });
      }

      const validComposites = termGrades
        .map((tg) => tg.termComposite)
        .filter((c): c is number => c !== null);

      let yearGrade: number | null = null;

      if (gradingModel === 'term_based') {
        yearGrade = this.simpleAverage(validComposites);
      } else {
        const termsAvg = this.simpleAverage(validComposites);

        const lastTerm = termResults[termResults.length - 1];
        const lastTermSubject = lastTerm?.subjects.find((s) => s.subjectId === subjectId);
        const finalExamAvg = lastTermSubject?.examAverage ?? null;

        if (termsAvg !== null && finalExamAvg !== null) {
          yearGrade = (termsAvg * yearCourseworkWeight / 100) + (finalExamAvg * yearExamWeight / 100);
          yearGrade = Math.round(yearGrade * 100) / 100;
        } else if (termsAvg !== null) {
          yearGrade = termsAvg;
        } else if (finalExamAvg !== null) {
          yearGrade = finalExamAvg;
        }
      }

      yearEndSubjects.push({ subjectId, subjectName, yearGrade, termGrades });
    }

    const yearGrades = yearEndSubjects
      .map((s) => s.yearGrade)
      .filter((g): g is number => g !== null);

    const overallYearAverage = this.simpleAverage(yearGrades);

    return {
      studentId,
      firstName,
      lastName,
      academicYearId,
      gradingModel,
      terms: termResults,
      yearEnd: {
        subjects: yearEndSubjects,
        overallAverage: overallYearAverage,
      },
    };
  }

  async calculateClassTermResults(termId: string, studentGroupId: string): Promise<StudentTermResult[]> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: enrollments } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .select('student_id')
      .eq('student_group_id', studentGroupId);

    if (!enrollments?.length) return [];

    const results: StudentTermResult[] = [];

    for (const e of enrollments) {
      const result = await this.calculateStudentTermResult(
        e.student_id,
        termId,
        studentGroupId,
      );
      results.push(result);
    }

    results.sort((a, b) => {
      const avgDiff = (b.overallAverage ?? -1) - (a.overallAverage ?? -1);
      if (avgDiff !== 0) return avgDiff;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '');
    });

    results.forEach((r, i) => {
      r.position = i + 1;
    });

    return results;
  }

  async calculateClassYearResults(academicYearId: string, studentGroupId: string): Promise<StudentYearResult[]> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: enrollments } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .select('student_id')
      .eq('student_group_id', studentGroupId);

    if (!enrollments?.length) return [];

    const results: StudentYearResult[] = [];

    for (const e of enrollments) {
      const result = await this.calculateStudentYearResult(
        e.student_id,
        academicYearId,
        studentGroupId,
      );
      results.push(result);
    }

    results.sort((a, b) => {
      const avgDiff = (b.yearEnd.overallAverage ?? -1) - (a.yearEnd.overallAverage ?? -1);
      if (avgDiff !== 0) return avgDiff;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '');
    });

    results.forEach((r, i) => {
      r.position = i + 1;
    });

    return results;
  }
}