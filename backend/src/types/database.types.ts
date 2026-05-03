export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
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
      school: {
        Row: {
          address: string | null;
          code: string | null;
          created_at: string | null;
          email: string | null;
          id: string;
          is_active: boolean | null;
          name: string | null;
          parish: string | null;
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
          parish?: string | null;
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
          parish?: string | null;
          phone?: string | null;
          school_type?: Database['public']['Enums']['schooltype'] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      student_group: {
        Row: {
          academic_year_id: string | null;
          id: string;
          name: string;
        };
        Insert: {
          academic_year_id?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          academic_year_id?: string | null;
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
      school_management: {
        Row: {
          id: string;
          user_id: string;
          school_id: string;
          role: Database['public']['Enums']['role'];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          school_id: string;
          role: Database['public']['Enums']['role'];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          school_id?: string;
          role?: Database['public']['Enums']['role'];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'school_management_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'user_profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'school_management_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'school';
            referencedColumns: ['id'];
          },
        ];
      };
      school_join_request: {
        Row: {
          id: string;
          user_id: string;
          school_id: string;
          status: Database['public']['Enums']['join_request_status'];
          message: string | null;
          requested_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          school_id: string;
          status?: Database['public']['Enums']['join_request_status'];
          message?: string | null;
          requested_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          school_id?: string;
          status?: Database['public']['Enums']['join_request_status'];
          message?: string | null;
          requested_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'school_join_request_user_id_fkey';
            columns: ['user_id'];
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
      gender: 'male' | 'female';
      gradingmodel: 'term_based' | 'year_based';
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
      report_book: {
        Row: {
          academic_year_id: string | null;
          attendance_days: number | null;
          conduct_grade: string | null;
          created_by: string | null;
          general_remarks: string | null;
          generated_at: string | null;
          id: string;
          published_at: string | null;
          report_type: Database['public']['Enums']['report_book_type'] | null;
          status: Database['public']['Enums']['report_book_status'] | null;
          student_id: string | null;
          term_id: string | null;
          total_school_days: number | null;
        };
        Insert: {
          academic_year_id?: string | null;
          attendance_days?: number | null;
          conduct_grade?: string | null;
          created_by?: string | null;
          general_remarks?: string | null;
          generated_at?: string | null;
          id?: string;
          published_at?: string | null;
          report_type?: Database['public']['Enums']['report_book_type'] | null;
          status?: Database['public']['Enums']['report_book_status'] | null;
          student_id?: string | null;
          term_id?: string | null;
          total_school_days?: number | null;
        };
        Update: {
          academic_year_id?: string | null;
          attendance_days?: number | null;
          conduct_grade?: string | null;
          created_by?: string | null;
          general_remarks?: string | null;
          generated_at?: string | null;
          id?: string;
          published_at?: string | null;
          report_type?: Database['public']['Enums']['report_book_type'] | null;
          status?: Database['public']['Enums']['report_book_status'] | null;
          student_id?: string | null;
          term_id?: string | null;
          total_school_days?: number | null;
        };
        Relationships: [];
      };
      report_book_entry: {
        Row: {
          id: string;
          is_graded: boolean | null;
          letter_grade: string | null;
          report_book_id: string | null;
          subject_id: string | null;
          teacher_remark: string | null;
          term_average: number | null;
        };
        Insert: {
          id?: string;
          is_graded?: boolean | null;
          letter_grade?: string | null;
          report_book_id?: string | null;
          subject_id?: string | null;
          teacher_remark?: string | null;
          term_average?: number | null;
        };
        Update: {
          id?: string;
          is_graded?: boolean | null;
          letter_grade?: string | null;
          report_book_id?: string | null;
          subject_id?: string | null;
          teacher_remark?: string | null;
          term_average?: number | null;
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
        };
        Insert: {
          academic_year_id?: string | null;
          id?: number;
          student_id?: string | null;
        };
        Update: {
          academic_year_id?: string | null;
          id?: number;
          student_id?: string | null;
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
  grading: {
    Enums: {},
  },
  public: {
    Enums: {
      assessment_type: ['exam', 'coursework'],
      gender: ['male', 'female'],
      gradingmodel: ['term_based', 'year_based'],
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
