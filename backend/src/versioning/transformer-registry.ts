import { Injectable, OnModuleInit } from '@nestjs/common';
import { VersioningService } from './versioning.service';

import * as auth from '@/auth/transformer';
import * as school from '@/school/transformer';
import * as student from '@/student/transformer';
import * as academicYear from '@/academic-year/transformer';
import * as term from '@/term/transformer';
import * as gradeScale from '@/grade-scale/transformer';
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
      uploadLimit: { 1: school.v1SchoolUploadLimit },
    });

    this.versioning.registerAll('student', {
      list: { 1: student.v1StudentList },
      detail: { 1: student.v1StudentDetail },
      updated: { 1: student.v1StudentUpdated },
      paginated: { 1: student.v1StudentPaginated },
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

    this.versioning.registerAll('gradeScale', {
      list: { 1: gradeScale.v1ScaleList },
      detail: { 1: gradeScale.v1ScaleDetail },
      created: { 1: gradeScale.v1ScaleCreated },
      updated: { 1: gradeScale.v1ScaleUpdated },
      bandsReplaced: { 1: gradeScale.v1BandsReplaced },
      defaultSet: { 1: gradeScale.v1DefaultSet },
      deleted: { 1: gradeScale.v1ScaleDeleted },
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
