# Calculation Module

**Location**: `backend/src/calculation/`

The calculation module performs all grade calculations - from individual subject grades to class-wide summaries with rankings. It is **read-only** (no data is written) and computes results on-the-fly from the raw grades stored in the grading module.

## Files

| File | Purpose |
|------|---------|
| `calculation.module.ts` | Module definition |
| `calculation.controller.ts` | API endpoints |
| `calculation.service.ts` | Calculation business logic |
| `interfaces/calculation.interfaces.ts` | TypeScript interfaces for result types |

## Key Concepts

### Weighted Term Grade Calculation

For each subject in a term, the grade is calculated as:

```
term_composite = (coursework_average × coursework_weight) + (exam_average × exam_weight)
```

Where:
- **Coursework average** = weighted average of all non-excluded coursework assessments, normalized to percentage
- **Exam average** = weighted average of all non-excluded exam assessments, normalized to percentage
- **coursework_weight** / **exam_weight** = the term's weight split (e.g., 40/60)

### Assessment Score Normalization

Each grade is normalized to a percentage before averaging:

```
normalized_score = (student_score / assessment_max_score) × 100
```

### Year-End Grade (year_based model only)

For `year_based` academic years, term composites are averaged across all terms, then split by the year's weights:

```
year_grade = (avg_coursework_across_terms × year_coursework_weight) +
             (avg_exam_across_terms × year_exam_weight)
```

### Overall Average

The overall average for a student is the simple average of all their graded subject composites.

### Class Position (Ranking)

Students are ranked by their overall average in descending order. Students with the same overall average receive the same position.

## Performance Optimization

The class-level calculation methods (`calculateClassTermResults` and `calculateClassYearResults`) use a **batch-fetch strategy** to avoid N+1 query problems:

1. Fetch all enrolled students in one query
2. Fetch all subject profiles for those students in one query
3. Fetch all assessments for the term in one query
4. Fetch all grades for those assessments in one query
5. Fetch term weights and subject metadata in parallel
6. Perform all calculations **in memory**

This results in a fixed number of database queries (6-7) regardless of how many students or subjects exist, compared to the naive approach of querying per-student-per-subject.

## Calculation Interfaces

### `SubjectGradeSummary`

```typescript
{
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  assessments: AssessmentGrade[];     // Individual assessment scores
  courseworkAverage: number | null;    // Weighted average of coursework
  examAverage: number | null;          // Weighted average of exams
  termComposite: number | null;        // Final term grade for this subject
}
```

### `StudentTermResult`

```typescript
{
  studentId: string;
  firstName: string;
  lastName: string;
  termId: string;
  subjects: SubjectGradeSummary[];
  overallAverage: number | null;       // Average across all graded subjects
  position?: number;                   // Class ranking (set during class calculations)
}
```

### `StudentYearResult`

```typescript
{
  studentId: string;
  firstName: string;
  lastName: string;
  gradingModel: string;
  terms: { termId, termName, subjects[], overallAverage }[];
  yearEnd: {
    subjects: YearEndSubject[];        // Per-subject year grades
    overallAverage: number | null;
  };
  position?: number;
}
```

## API Endpoints

All endpoints require `AuthGuard`. Class-level endpoints additionally require the user to be an **admin or class teacher**.

### `GET /api/v1/calculations/student-term`

Calculates a single student's term results.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `studentId` | Yes | Student UUID |
| `termId` | Yes | Term UUID |
| `studentGroupId` | Yes | Class UUID |

**Response:** `StudentTermResult` - subjects with per-assessment scores, averages, and composites.

---

### `GET /api/v1/calculations/student-year`

Calculates a single student's year-end results.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `studentId` | Yes | Student UUID |
| `academicYearId` | Yes | Academic year UUID |
| `studentGroupId` | Yes | Class UUID |

---

### `GET /api/v1/calculations/class-term`

**Access:** Admin or class teacher only.

Calculates term results for **all students** in a class, with rankings.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `termId` | Yes | Term UUID |
| `studentGroupId` | Yes | Class UUID |

**Response:** Array of `StudentTermResult` objects sorted by position.

---

### `GET /api/v1/calculations/class-year`

**Access:** Admin or class teacher only.

Calculates year-end results for all students, including per-term breakdowns and year-end grades.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `academicYearId` | Yes | Academic year UUID |
| `studentGroupId` | Yes | Class UUID |

---

### `GET /api/v1/calculations/class-summary`

**Access:** Admin or class teacher only.

A slimmer version of `class-term` that returns only the data needed for the class summary table (no individual assessment breakdowns).

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `termId` | Yes | Term UUID |
| `studentGroupId` | Yes | Class UUID |

**Response:**
```json
[
  {
    "student": { "id": "uuid", "firstName": "Jane", "lastName": "Doe" },
    "subjects": [
      { "subjectId": "uuid", "subjectName": "Mathematics", "average": 85.5 }
    ],
    "overallAverage": 82.3,
    "position": 1
  }
]
```
