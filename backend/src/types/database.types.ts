export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  file_manager: {
    Tables: {
      file: {
        Row: {
          bucket: string;
          content_type: string;
          created_at: string | null;
          deleted_at: string | null;
          id: string;
          name: string;
          owner_id: string;
          scan_detail: string | null;
          school_id: string;
          size_bytes: number;
          source: Database['file_manager']['Enums']['file_source'];
          source_ref: string | null;
          status: Database['file_manager']['Enums']['file_status'];
          storage_path: string;
          updated_at: string | null;
        };
        Insert: {
          bucket?: string;
          content_type?: string;
          created_at?: string | null;
          deleted_at?: string | null;
          id?: string;
          name: string;
          owner_id: string;
          scan_detail?: string | null;
          school_id: string;
          size_bytes?: number;
          source?: Database['file_manager']['Enums']['file_source'];
          source_ref?: string | null;
          status?: Database['file_manager']['Enums']['file_status'];
          storage_path: string;
          updated_at?: string | null;
        };
        Update: {
          bucket?: string;
          content_type?: string;
          created_at?: string | null;
          deleted_at?: string | null;
          id?: string;
          name?: string;
          owner_id?: string;
          scan_detail?: string | null;
          school_id?: string;
          size_bytes?: number;
          source?: Database['file_manager']['Enums']['file_source'];
          source_ref?: string | null;
          status?: Database['file_manager']['Enums']['file_status'];
          storage_path?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      file_share: {
        Row: {
          can_download: boolean;
          created_at: string | null;
          created_by: string | null;
          file_id: string;
          id: string;
          principal_id: string;
          principal_type: Database['file_manager']['Enums']['share_principal'];
          school_id: string;
        };
        Insert: {
          can_download?: boolean;
          created_at?: string | null;
          created_by?: string | null;
          file_id: string;
          id?: string;
          principal_id: string;
          principal_type: Database['file_manager']['Enums']['share_principal'];
          school_id: string;
        };
        Update: {
          can_download?: boolean;
          created_at?: string | null;
          created_by?: string | null;
          file_id?: string;
          id?: string;
          principal_id?: string;
          principal_type?: Database['file_manager']['Enums']['share_principal'];
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'file_share_file_id_fkey';
            columns: ['file_id'];
            isOneToOne: false;
            referencedRelation: 'file';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      file_source: 'report' | 'upload';
      file_status: 'pending' | 'scanning' | 'ready' | 'failed' | 'infected';
      share_principal: 'user' | 'role' | 'group';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  grading: {
    Tables: {
      assessment: {
        Row: {
          assessment_date: string | null;
          assessment_type:
            | Database['public']['Enums']['assessment_type']
            | null;
          exclusion_reason: string | null;
          id: string;
          is_excluded: boolean | null;
          max_score: number | null;
          sort_order: number | null;
          subject_id: string | null;
          term_id: string | null;
          title: string | null;
          weight: number | null;
        };
        Insert: {
          assessment_date?: string | null;
          assessment_type?:
            | Database['public']['Enums']['assessment_type']
            | null;
          exclusion_reason?: string | null;
          id?: string;
          is_excluded?: boolean | null;
          max_score?: number | null;
          sort_order?: number | null;
          subject_id?: string | null;
          term_id?: string | null;
          title?: string | null;
          weight?: number | null;
        };
        Update: {
          assessment_date?: string | null;
          assessment_type?:
            | Database['public']['Enums']['assessment_type']
            | null;
          exclusion_reason?: string | null;
          id?: string;
          is_excluded?: boolean | null;
          max_score?: number | null;
          sort_order?: number | null;
          subject_id?: string | null;
          term_id?: string | null;
          title?: string | null;
          weight?: number | null;
        };
        Relationships: [];
      };
      grade: {
        Row: {
          assessment_id: string | null;
          created_at: string | null;
          created_by: string | null;
          exclusion_reason: string | null;
          id: string;
          is_excluded: boolean | null;
          letter_grade: string | null;
          remarks: string | null;
          score: number | null;
          student_id: string | null;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          assessment_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          exclusion_reason?: string | null;
          id?: string;
          is_excluded?: boolean | null;
          letter_grade?: string | null;
          remarks?: string | null;
          score?: number | null;
          student_id?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          assessment_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          exclusion_reason?: string | null;
          id?: string;
          is_excluded?: boolean | null;
          letter_grade?: string | null;
          remarks?: string | null;
          score?: number | null;
          student_id?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'grade_assessment_id_fkey';
            columns: ['assessment_id'];
            isOneToOne: false;
            referencedRelation: 'assessment';
            referencedColumns: ['id'];
          },
        ];
      };
      grade_scale: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          id: string;
          is_default: boolean;
          name: string;
          scale_type: Database['public']['Enums']['grade_scale_type'];
          school_id: string;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          is_default?: boolean;
          name: string;
          scale_type: Database['public']['Enums']['grade_scale_type'];
          school_id: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          is_default?: boolean;
          name?: string;
          scale_type?: Database['public']['Enums']['grade_scale_type'];
          school_id?: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      grade_scale_band: {
        Row: {
          created_at: string | null;
          gpa_points: number | null;
          grade_scale_id: string;
          id: string;
          is_pass: boolean;
          label: string;
          max_percentage: number;
          min_percentage: number;
          sort_order: number;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          gpa_points?: number | null;
          grade_scale_id: string;
          id?: string;
          is_pass?: boolean;
          label: string;
          max_percentage: number;
          min_percentage: number;
          sort_order?: number;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          gpa_points?: number | null;
          grade_scale_id?: string;
          id?: string;
          is_pass?: boolean;
          label?: string;
          max_percentage?: number;
          min_percentage?: number;
          sort_order?: number;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'grade_scale_band_scale_fkey';
            columns: ['grade_scale_id'];
            isOneToOne: false;
            referencedRelation: 'grade_scale';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      academic_year: {
        Row: {
          end_date: string | null;
          grading_model: Database['public']['Enums']['gradingmodel'] | null;
          id: string;
          is_active: boolean | null;
          name: string | null;
          school_id: string | null;
          start_date: string | null;
          year_coursework_weight: number | null;
          year_exam_weight: number | null;
        };
        Insert: {
          end_date?: string | null;
          grading_model?: Database['public']['Enums']['gradingmodel'] | null;
          id?: string;
          is_active?: boolean | null;
          name?: string | null;
          school_id?: string | null;
          start_date?: string | null;
          year_coursework_weight?: number | null;
          year_exam_weight?: number | null;
        };
        Update: {
          end_date?: string | null;
          grading_model?: Database['public']['Enums']['gradingmodel'] | null;
          id?: string;
          is_active?: boolean | null;
          name?: string | null;
          school_id?: string | null;
          start_date?: string | null;
          year_coursework_weight?: number | null;
          year_exam_weight?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'academic_year_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
        ];
      };
      announcement: {
        Row: {
          author_user_profile_id: string | null;
          body: string | null;
          created_at: string | null;
          id: string;
          school_id: string;
          title: string;
          updated_at: string | null;
        };
        Insert: {
          author_user_profile_id?: string | null;
          body?: string | null;
          created_at?: string | null;
          id?: string;
          school_id: string;
          title: string;
          updated_at?: string | null;
        };
        Update: {
          author_user_profile_id?: string | null;
          body?: string | null;
          created_at?: string | null;
          id?: string;
          school_id?: string;
          title?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'announcement_author_user_profile_id_fkey';
            columns: ['author_user_profile_id'];
            isOneToOne: false;
            referencedRelation: 'user_profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcement_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
        ];
      };
      announcement_read: {
        Row: {
          announcement_id: string;
          read_at: string | null;
          user_profile_id: string;
        };
        Insert: {
          announcement_id: string;
          read_at?: string | null;
          user_profile_id: string;
        };
        Update: {
          announcement_id?: string;
          read_at?: string | null;
          user_profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'announcement_read_announcement_id_fkey';
            columns: ['announcement_id'];
            isOneToOne: false;
            referencedRelation: 'announcement';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'announcement_read_user_profile_id_fkey';
            columns: ['user_profile_id'];
            isOneToOne: false;
            referencedRelation: 'user_profile';
            referencedColumns: ['id'];
          },
        ];
      };
      permission_catalog: {
        Row: {
          action: string;
          created_at: string;
          description: string | null;
          id: string;
          key: string;
          resource: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          key: string;
          resource: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          key?: string;
          resource?: string;
        };
        Relationships: [];
      };
      school: {
        Row: {
          address: string | null;
          code: string | null;
          created_at: string | null;
          email: string | null;
          id: string;
          is_active: boolean | null;
          name: string | null;
          phone: string | null;
          school_type: Database['public']['Enums']['schooltype'] | null;
          updated_at: string | null;
        };
        Insert: {
          address?: string | null;
          code?: string | null;
          created_at?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean | null;
          name?: string | null;
          phone?: string | null;
          school_type?: Database['public']['Enums']['schooltype'] | null;
          updated_at?: string | null;
        };
        Update: {
          address?: string | null;
          code?: string | null;
          created_at?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean | null;
          name?: string | null;
          phone?: string | null;
          school_type?: Database['public']['Enums']['schooltype'] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      school_join_request: {
        Row: {
          id: string;
          message: string | null;
          requested_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          school_id: string;
          status: Database['public']['Enums']['join_request_status'];
          user_id: string;
        };
        Insert: {
          id?: string;
          message?: string | null;
          requested_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          school_id: string;
          status?: Database['public']['Enums']['join_request_status'];
          user_id: string;
        };
        Update: {
          id?: string;
          message?: string | null;
          requested_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          school_id?: string;
          status?: Database['public']['Enums']['join_request_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'school_join_request_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'user_profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'school_join_request_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'school_join_request_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'user_profile';
            referencedColumns: ['id'];
          },
        ];
      };
      school_management: {
        Row: {
          created_at: string;
          id: string;
          role: Database['public']['Enums']['role'];
          school_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database['public']['Enums']['role'];
          school_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database['public']['Enums']['role'];
          school_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'school_management_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'school_management_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'user_profile';
            referencedColumns: ['id'];
          },
        ];
      };
      school_management_role: {
        Row: {
          created_at: string;
          id: string;
          school_management_id: string;
          school_role_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          school_management_id: string;
          school_role_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          school_management_id?: string;
          school_role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'school_management_role_management_fkey';
            columns: ['school_management_id'];
            isOneToOne: false;
            referencedRelation: 'school_management';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'school_management_role_role_fkey';
            columns: ['school_role_id'];
            isOneToOne: false;
            referencedRelation: 'school_role';
            referencedColumns: ['id'];
          },
        ];
      };
      school_role: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_system: boolean;
          name: string;
          school_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          school_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          school_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'school_role_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
        ];
      };
      school_role_permission: {
        Row: {
          created_at: string;
          id: string;
          permission_id: string;
          school_role_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          permission_id: string;
          school_role_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          permission_id?: string;
          school_role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'school_role_permission_permission_fkey';
            columns: ['permission_id'];
            isOneToOne: false;
            referencedRelation: 'permission_catalog';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'school_role_permission_role_fkey';
            columns: ['school_role_id'];
            isOneToOne: false;
            referencedRelation: 'school_role';
            referencedColumns: ['id'];
          },
        ];
      };
      student_group: {
        Row: {
          academic_year_id: string | null;
          created_at: string | null;
          created_by: string | null;
          id: string;
          name: string;
        };
        Insert: {
          academic_year_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          academic_year_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_group_academic_year_id_fkey';
            columns: ['academic_year_id'];
            isOneToOne: false;
            referencedRelation: 'academic_year';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_group_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'user_profile';
            referencedColumns: ['id'];
          },
        ];
      };
      subject: {
        Row: {
          code: string | null;
          id: string;
          is_graded: boolean | null;
          name: string | null;
          school_id: string | null;
          sort_order: number | null;
        };
        Insert: {
          code?: string | null;
          id?: string;
          is_graded?: boolean | null;
          name?: string | null;
          school_id?: string | null;
          sort_order?: number | null;
        };
        Update: {
          code?: string | null;
          id?: string;
          is_graded?: boolean | null;
          name?: string | null;
          school_id?: string | null;
          sort_order?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'subject_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
        ];
      };
      term: {
        Row: {
          academic_year_id: string | null;
          coursework_weight: number | null;
          end_date: string | null;
          exam_weight: number | null;
          id: string;
          is_ministry_reporting: boolean | null;
          name: Database['public']['Enums']['term_name'] | null;
          sort_order: number | null;
          start_date: string | null;
        };
        Insert: {
          academic_year_id?: string | null;
          coursework_weight?: number | null;
          end_date?: string | null;
          exam_weight?: number | null;
          id?: string;
          is_ministry_reporting?: boolean | null;
          name?: Database['public']['Enums']['term_name'] | null;
          sort_order?: number | null;
          start_date?: string | null;
        };
        Update: {
          academic_year_id?: string | null;
          coursework_weight?: number | null;
          end_date?: string | null;
          exam_weight?: number | null;
          id?: string;
          is_ministry_reporting?: boolean | null;
          name?: Database['public']['Enums']['term_name'] | null;
          sort_order?: number | null;
          start_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'term_academic_year_id_fkey';
            columns: ['academic_year_id'];
            isOneToOne: false;
            referencedRelation: 'academic_year';
            referencedColumns: ['id'];
          },
        ];
      };
      user_profile: {
        Row: {
          avatar_url: string | null;
          created_at: string | null;
          email: string | null;
          first_name: string | null;
          id: string;
          is_active: boolean | null;
          last_name: string | null;
          role: Database['public']['Enums']['role'] | null;
          school_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_name?: string | null;
          role?: Database['public']['Enums']['role'] | null;
          school_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_name?: string | null;
          role?: Database['public']['Enums']['role'] | null;
          school_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'user_profile_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_user_school_id: { Args: never; Returns: string };
      is_admin: { Args: never; Returns: boolean };
      is_assigned_to_group: { Args: { p_group_id: string }; Returns: boolean };
      is_assigned_to_subject_in_group: {
        Args: { p_group_id: string; p_subject_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      assessment_type: 'exam' | 'coursework';
      attendance_status: 'present' | 'absent' | 'late';
      gender: 'male' | 'female';
      grade_scale_type: 'letter' | 'gpa' | 'pass_fail';
      gradingmodel:
        | 'weighted_continuous'
        | 'weighted_cumulative'
        | 'continuous_cumulative';
      join_request_status: 'pending' | 'approved' | 'rejected';
      relationship_type: 'mother' | 'father' | 'guardian';
      report_book_status: 'draft' | 'published' | 'sent_to_ministry';
      report_book_type: 'term' | 'year_end';
      role: 'admin' | 'teacher' | 'member';
      schooltype: 'primary' | 'secondary';
      term_name: 'michaelmas' | 'hilary' | 'trinity';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  reporting: {
    Tables: {
      class_report_file: {
        Row: {
          file_path: string;
          file_size: number;
          file_type: string;
          generated_at: string | null;
          generated_by: string | null;
          id: string;
          report_type: string;
          student_group_id: string;
          term_id: string;
        };
        Insert: {
          file_path: string;
          file_size: number;
          file_type: string;
          generated_at?: string | null;
          generated_by?: string | null;
          id?: string;
          report_type: string;
          student_group_id: string;
          term_id: string;
        };
        Update: {
          file_path?: string;
          file_size?: number;
          file_type?: string;
          generated_at?: string | null;
          generated_by?: string | null;
          id?: string;
          report_type?: string;
          student_group_id?: string;
          term_id?: string;
        };
        Relationships: [];
      };
      report_book: {
        Row: {
          academic_year_id: string | null;
          attendance_days: number | null;
          conduct_grade: string | null;
          created_by: string | null;
          general_remarks: string | null;
          generated_at: string | null;
          id: string;
          overall_average: number | null;
          position: number | null;
          published_at: string | null;
          report_type: Database['public']['Enums']['report_book_type'] | null;
          status: Database['public']['Enums']['report_book_status'] | null;
          student_group_id: string | null;
          student_id: string | null;
          term_id: string | null;
          total_school_days: number | null;
          total_students: number | null;
        };
        Insert: {
          academic_year_id?: string | null;
          attendance_days?: number | null;
          conduct_grade?: string | null;
          created_by?: string | null;
          general_remarks?: string | null;
          generated_at?: string | null;
          id?: string;
          overall_average?: number | null;
          position?: number | null;
          published_at?: string | null;
          report_type?: Database['public']['Enums']['report_book_type'] | null;
          status?: Database['public']['Enums']['report_book_status'] | null;
          student_group_id?: string | null;
          student_id?: string | null;
          term_id?: string | null;
          total_school_days?: number | null;
          total_students?: number | null;
        };
        Update: {
          academic_year_id?: string | null;
          attendance_days?: number | null;
          conduct_grade?: string | null;
          created_by?: string | null;
          general_remarks?: string | null;
          generated_at?: string | null;
          id?: string;
          overall_average?: number | null;
          position?: number | null;
          published_at?: string | null;
          report_type?: Database['public']['Enums']['report_book_type'] | null;
          status?: Database['public']['Enums']['report_book_status'] | null;
          student_group_id?: string | null;
          student_id?: string | null;
          term_id?: string | null;
          total_school_days?: number | null;
          total_students?: number | null;
        };
        Relationships: [];
      };
      report_book_entry: {
        Row: {
          coursework_average: number | null;
          exam_average: number | null;
          id: string;
          is_graded: boolean | null;
          letter_grade: string | null;
          report_book_id: string | null;
          sort_order: number | null;
          subject_id: string | null;
          teacher_remark: string | null;
          term_average: number | null;
          term_composite: number | null;
          term_grade: number | null;
          year_grade: number | null;
        };
        Insert: {
          coursework_average?: number | null;
          exam_average?: number | null;
          id?: string;
          is_graded?: boolean | null;
          letter_grade?: string | null;
          report_book_id?: string | null;
          sort_order?: number | null;
          subject_id?: string | null;
          teacher_remark?: string | null;
          term_average?: number | null;
          term_composite?: number | null;
          term_grade?: number | null;
          year_grade?: number | null;
        };
        Update: {
          coursework_average?: number | null;
          exam_average?: number | null;
          id?: string;
          is_graded?: boolean | null;
          letter_grade?: string | null;
          report_book_id?: string | null;
          sort_order?: number | null;
          subject_id?: string | null;
          teacher_remark?: string | null;
          term_average?: number | null;
          term_composite?: number | null;
          term_grade?: number | null;
          year_grade?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'report_book_entry_report_book_id_fkey';
            columns: ['report_book_id'];
            isOneToOne: false;
            referencedRelation: 'report_book';
            referencedColumns: ['id'];
          },
        ];
      };
      report_book_pdf: {
        Row: {
          file_path: string;
          file_size: number | null;
          generated_at: string;
          generated_by: string;
          id: string;
          report_book_id: string;
        };
        Insert: {
          file_path: string;
          file_size?: number | null;
          generated_at?: string;
          generated_by: string;
          id?: string;
          report_book_id: string;
        };
        Update: {
          file_path?: string;
          file_size?: number | null;
          generated_at?: string;
          generated_by?: string;
          id?: string;
          report_book_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'report_book_pdf_report_book_id_fkey';
            columns: ['report_book_id'];
            isOneToOne: false;
            referencedRelation: 'report_book';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  staff: {
    Tables: {
      teacher_group_assignment: {
        Row: {
          academic_year_id: string | null;
          id: number;
          is_class_teacher: boolean | null;
          student_group_id: string | null;
          user_profile_id: string | null;
        };
        Insert: {
          academic_year_id?: string | null;
          id?: number;
          is_class_teacher?: boolean | null;
          student_group_id?: string | null;
          user_profile_id?: string | null;
        };
        Update: {
          academic_year_id?: string | null;
          id?: number;
          is_class_teacher?: boolean | null;
          student_group_id?: string | null;
          user_profile_id?: string | null;
        };
        Relationships: [];
      };
      teacher_subject_assignment: {
        Row: {
          academic_year_id: string | null;
          id: string;
          student_group_id: string | null;
          subject_id: string | null;
          user_profile_id: string | null;
        };
        Insert: {
          academic_year_id?: string | null;
          id?: string;
          student_group_id?: string | null;
          subject_id?: string | null;
          user_profile_id?: string | null;
        };
        Update: {
          academic_year_id?: string | null;
          id?: string;
          student_group_id?: string | null;
          subject_id?: string | null;
          user_profile_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  student: {
    Tables: {
      attendance_record: {
        Row: {
          attendance_date: string;
          created_at: string | null;
          created_by: string | null;
          id: string;
          notes: string | null;
          status: Database['public']['Enums']['attendance_status'];
          student_group_id: string;
          student_id: string;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          attendance_date: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          status: Database['public']['Enums']['attendance_status'];
          student_group_id: string;
          student_id: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          attendance_date?: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          status?: Database['public']['Enums']['attendance_status'];
          student_group_id?: string;
          student_id?: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'attendance_record_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'student';
            referencedColumns: ['id'];
          },
        ];
      };
      parent_student_link: {
        Row: {
          id: string;
          relationship: Database['public']['Enums']['relationship_type'] | null;
          student_id: string | null;
          user_profile_id: string | null;
        };
        Insert: {
          id?: string;
          relationship?:
            | Database['public']['Enums']['relationship_type']
            | null;
          student_id?: string | null;
          user_profile_id?: string | null;
        };
        Update: {
          id?: string;
          relationship?:
            | Database['public']['Enums']['relationship_type']
            | null;
          student_id?: string | null;
          user_profile_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'parent_student_link_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'student';
            referencedColumns: ['id'];
          },
        ];
      };
      student: {
        Row: {
          date_of_birth: string | null;
          enrollement_date: string | null;
          first_name: string | null;
          gender: string | null;
          id: string;
          is_active: boolean | null;
          last_name: string | null;
          school_id: string | null;
        };
        Insert: {
          date_of_birth?: string | null;
          enrollement_date?: string | null;
          first_name?: string | null;
          gender?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_name?: string | null;
          school_id?: string | null;
        };
        Update: {
          date_of_birth?: string | null;
          enrollement_date?: string | null;
          first_name?: string | null;
          gender?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_name?: string | null;
          school_id?: string | null;
        };
        Relationships: [];
      };
      student_group_enrollment: {
        Row: {
          enrolled_at: string | null;
          id: string;
          student_group_id: string | null;
          student_id: string | null;
        };
        Insert: {
          enrolled_at?: string | null;
          id?: string;
          student_group_id?: string | null;
          student_id?: string | null;
        };
        Update: {
          enrolled_at?: string | null;
          id?: string;
          student_group_id?: string | null;
          student_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'student_group_enrollment_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'student';
            referencedColumns: ['id'];
          },
        ];
      };
      student_subject_profile: {
        Row: {
          academic_year_id: string | null;
          id: number;
          student_id: string | null;
          subject_id: string | null;
        };
        Insert: {
          academic_year_id?: string | null;
          id?: number;
          student_id?: string | null;
          subject_id?: string | null;
        };
        Update: {
          academic_year_id?: string | null;
          id?: number;
          student_id?: string | null;
          subject_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'student_subject_profile_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'student';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  file_manager: {
    Enums: {
      file_source: ['report', 'upload'],
      file_status: ['pending', 'scanning', 'ready', 'failed', 'infected'],
      share_principal: ['user', 'role', 'group'],
    },
  },
  grading: {
    Enums: {},
  },
  public: {
    Enums: {
      assessment_type: ['exam', 'coursework'],
      attendance_status: ['present', 'absent', 'late'],
      gender: ['male', 'female'],
      grade_scale_type: ['letter', 'gpa', 'pass_fail'],
      gradingmodel: [
        'weighted_continuous',
        'weighted_cumulative',
        'continuous_cumulative',
      ],
      join_request_status: ['pending', 'approved', 'rejected'],
      relationship_type: ['mother', 'father', 'guardian'],
      report_book_status: ['draft', 'published', 'sent_to_ministry'],
      report_book_type: ['term', 'year_end'],
      role: ['admin', 'teacher', 'member'],
      schooltype: ['primary', 'secondary'],
      term_name: ['michaelmas', 'hilary', 'trinity'],
    },
  },
  reporting: {
    Enums: {},
  },
  staff: {
    Enums: {},
  },
  student: {
    Enums: {},
  },
} as const;
