import { Injectable, OnModuleInit } from '@nestjs/common';
import { VersioningService } from './versioning.service';

import * as auth from '@/auth/transformer';
import * as school from '@/school/transformer';
import * as student from '@/student/transformer';
import * as klass from '@/class/transformer';
import * as academicYear from '@/academic-year/transformer';
import * as term from '@/term/transformer';
import * as subject from '@/subject/transformer';
import * as enrollment from '@/enrollment/transformer';
import * as attendance from '@/attendance/transformer';
import * as grade from '@/grading/transformer';
import * as gradeScale from '@/grade-scale/transformer';
import * as calculation from '@/calculation/transformer';
import * as report from '@/reporting/transformer';
import * as announcement from '@/announcement/transformer';
import * as images from '@/images/transformer';

@Injectable()
export class TransformerRegistry implements OnModuleInit {
  constructor(private readonly versioning: VersioningService) {}

  onModuleInit() {
    this.versioning.registerAll('auth', {
      profile: { 1: auth.v1Profile },
      session: { 1: auth.v1Session },
      verifyOtp: { 1: auth.v1VerifyOtp },
      message: { 1: auth.v1Message },
    });

    this.versioning.registerAll('school', {
      list: { 1: school.v1SchoolList },
      detail: { 1: school.v1SchoolDetail },
    });

    this.versioning.registerAll('student', {
      list: { 1: student.v1StudentList },
      detail: { 1: student.v1StudentDetail },
      created: { 1: student.v1StudentCreated },
      updated: { 1: student.v1StudentUpdated },
      paginated: { 1: student.v1StudentPaginated },
    });

    this.versioning.registerAll('class', {
      list: { 1: klass.v1ClassList },
      detail: { 1: klass.v1ClassDetail },
      created: { 1: klass.v1ClassCreated },
      updated: { 1: klass.v1ClassUpdated },
      deleted: { 1: klass.v1ClassDeleted },
      teachers: { 1: klass.v1TeacherList },
      teacherAdded: { 1: klass.v1TeacherAdded },
      teacherRemoved: { 1: klass.v1TeacherRemoved },
      subjects: { 1: klass.v1SubjectList },
    });

    this.versioning.registerAll('academicYear', {
      list: { 1: academicYear.v1YearList },
      detail: { 1: academicYear.v1YearDetail },
      created: { 1: academicYear.v1YearCreated },
      updated: { 1: academicYear.v1YearUpdated },
    });

    this.versioning.registerAll('term', {
      list: { 1: term.v1TermList },
      detail: { 1: term.v1TermDetail },
      created: { 1: term.v1TermCreated },
      updated: { 1: term.v1TermUpdated },
      deleted: { 1: term.v1TermDeleted },
    });

    this.versioning.registerAll('subject', {
      list: { 1: subject.v1SubjectList },
      detail: { 1: subject.v1SubjectDetail },
      created: { 1: subject.v1SubjectCreated },
      updated: { 1: subject.v1SubjectUpdated },
      deleted: { 1: subject.v1SubjectDeleted },
    });

    this.versioning.registerAll('enrollment', {
      students: { 1: enrollment.v1EnrolledStudents },
      studentSubjects: { 1: enrollment.v1StudentSubjects },
      enrolled: { 1: enrollment.v1Enrolled },
      bulkEnrolled: { 1: enrollment.v1BulkEnrolled },
      unenrolled: { 1: enrollment.v1Unenrolled },
      subjectsAssigned: { 1: enrollment.v1SubjectsAssigned },
      bulkSubjectsAssigned: { 1: enrollment.v1BulkSubjectsAssigned },
      subjectRemoved: { 1: enrollment.v1SubjectRemoved },
    });

    this.versioning.registerAll('attendance', {
      roster: { 1: attendance.v1Roster },
      marked: { 1: attendance.v1Marked },
      bulkMarked: { 1: attendance.v1BulkMarked },
      updated: { 1: attendance.v1Updated },
      deleted: { 1: attendance.v1Deleted },
      studentRange: { 1: attendance.v1StudentRange },
      studentSummary: { 1: attendance.v1StudentSummary },
    });

    this.versioning.registerAll('grade', {
      byAssessment: { 1: grade.v1GradesByAssessment },
      byTermSubject: { 1: grade.v1GradesByTermSubject },
      created: { 1: grade.v1GradeCreated },
      bulkGraded: { 1: grade.v1BulkGraded },
      updated: { 1: grade.v1GradeUpdated },
      excluded: { 1: grade.v1GradeExcluded },
    });

    this.versioning.registerAll('assessment', {
      list: { 1: grade.v1AssessmentList },
      detail: { 1: grade.v1AssessmentDetail },
      created: { 1: grade.v1AssessmentCreated },
      updated: { 1: grade.v1AssessmentUpdated },
      excluded: { 1: grade.v1AssessmentExcluded },
      deleted: { 1: grade.v1AssessmentDeleted },
    });

    this.versioning.registerAll('gradeScale', {
      list: { 1: gradeScale.v1ScaleList },
      detail: { 1: gradeScale.v1ScaleDetail },
      created: { 1: gradeScale.v1ScaleCreated },
      updated: { 1: gradeScale.v1ScaleUpdated },
      bandsReplaced: { 1: gradeScale.v1BandsReplaced },
      defaultSet: { 1: gradeScale.v1DefaultSet },
      deleted: { 1: gradeScale.v1ScaleDeleted },
    });

    this.versioning.registerAll('calculation', {
      studentTerm: { 1: calculation.v1StudentTermResult },
      studentYear: { 1: calculation.v1StudentYearResult },
      classTerm: { 1: calculation.v1ClassTermResults },
      classYear: { 1: calculation.v1ClassYearResults },
      classSummary: { 1: calculation.v1ClassSummary },
    });

    this.versioning.registerAll('report', {
      list: { 1: report.v1ReportList },
      detail: { 1: report.v1ReportDetail },
      generated: { 1: report.v1ReportGenerated },
      updated: { 1: report.v1ReportUpdated },
      classSummary: { 1: report.v1ClassSummary },
      classSummaryFiles: { 1: report.v1ClassSummaryFiles },
      classSummaryUploaded: { 1: report.v1ClassSummaryUploaded },
      studentReport: { 1: report.v1StudentReport },
      pdfHistory: { 1: report.v1PdfHistory },
      pdfLatest: { 1: report.v1PdfLatest },
      pdfSaved: { 1: report.v1PdfSaved },
      pdfUploaded: { 1: report.v1PdfUploaded },
    });

    this.versioning.registerAll('reportEntry', {
      updated: { 1: report.v1ReportEntryUpdated },
    });

    this.versioning.registerAll('announcement', {
      list: { 1: announcement.v1AnnouncementList },
      detail: { 1: announcement.v1AnnouncementDetail },
      created: { 1: announcement.v1AnnouncementCreated },
      updated: { 1: announcement.v1AnnouncementUpdated },
      deleted: { 1: announcement.v1AnnouncementDeleted },
      unreadCount: { 1: announcement.v1AnnouncementUnreadCount },
      markRead: { 1: announcement.v1AnnouncementMarkRead },
    });

    this.versioning.registerAll('images', {
      uploaded: { 1: images.v1Uploaded },
      resumable: { 1: images.v1Resumable },
    });
  }
}
