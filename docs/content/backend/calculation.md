---
sidebar_label: Calculation
---

# Calculation Module

**Location**: `backend/src/calculation/`

The calculation module performs all grade calculations - from individual subject grades to class-wide summaries with rankings. It is **read-only** (no data is written) and computes results on-the-fly from the raw grades stored in the grading module.

## Files

| File | Purpose |
|------|---------|
| `calculation.module.ts` | Module definition |
| `calculation.controller.ts` | API endpoints |
| `calculation.service.ts` | Orchestrator — delegates to grading system strategies |
| `interfaces/calculation.interfaces.ts` | TypeScript interfaces for result types |
| `grading-systems/grading-system.factory.ts` | Factory that resolves grading model → service |
| `grading-systems/weighted-continuous/` | Weighted Continuous Assessment strategy |
| `grading-systems/weighted-cumulative/` | Weighted Cumulative strategy |
| `grading-systems/continuous-cumulative/` | Continuous-Cumulative (Hybrid) strategy |

Each grading system folder contains:
- `index.ts` — service class implementing `calculateSubjectTermGrade` and `calculateSubjectYearGrade`
- `*.rules.ts` — static rules object defining term/year behaviour

## Grading System Architecture (added 2026-05-17)

The calculation module uses a **Strategy pattern**. `CalculationService` delegates grade computation to whichever grading system is selected on the academic year:

```
CalculationService → GradingSystemFactory.getService(model) → WeightedContinuousService
                                                             → WeightedCumulativeService
                                                             → ContinuousCumulativeService
```

To add a new grading system:
1. Create a new folder under `grading-systems/`
2. Implement `calculateSubjectTermGrade()` and `calculateSubjectYearGrade()`
3. Add a rules file
4. Register in `GradingSystemFactory`
5. Add the enum value to the `gradingmodel` database type

## Grading Models

### Weighted Continuous Assessment (`weighted_continuous`)

Each term has independent coursework and exams. At year-end, term composites are averaged and combined with year weights.

```
term_composite = (coursework_avg × cw_weight) + (exam_avg × ex_weight)
year_grade = (avg_of_term_composites × year_cw_weight) + (avg_of_term_exams × year_ex_weight)
```

### Weighted Cumulative (`weighted_cumulative`)

All coursework across all terms is pooled together into a single CA total. Term boundaries are ignored for the year-end calculation.

```
term_composite = (coursework_avg × cw_weight) + (exam_avg × ex_weight)
year_grade = (pooled_cw_avg × year_cw_weight) + (pooled_exam_avg × year_ex_weight)
```

### Continuous-Cumulative (`continuous_cumulative`)

Each term has coursework only (no per-term exam). At year-end, all term coursework is combined and paired with a single final exam from the last term.

```
term_composite = coursework_avg only (no exam)
year_grade = (avg_of_term_composites × year_cw_weight) + (final_term_exam × year_ex_weight)
```

## Key Concepts

### Assessment Score Normalization

Each grade is normalized to a percentage before averaging:

```
normalized_score = (student_score / assessment_max_score) × 100
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

### `GET /api/calculations/student-term`

Calculates a single student's term results.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `studentId` | Yes | Student UUID |
| `termId` | Yes | Term UUID |
| `studentGroupId` | Yes | Class UUID |

**Response:** `StudentTermResult` - subjects with per-assessment scores, averages, and composites.

---

### `GET /api/calculations/student-year`

Calculates a single student's year-end results.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `studentId` | Yes | Student UUID |
| `academicYearId` | Yes | Academic year UUID |
| `studentGroupId` | Yes | Class UUID |

---

### `GET /api/calculations/class-term`

**Access:** Admin or class teacher only.

Calculates term results for **all students** in a class, with rankings.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `termId` | Yes | Term UUID |
| `studentGroupId` | Yes | Class UUID |

**Response:** Array of `StudentTermResult` objects sorted by position.

---

### `GET /api/calculations/class-year`

**Access:** Admin or class teacher only.

Calculates year-end results for all students, including per-term breakdowns and year-end grades.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `academicYearId` | Yes | Academic year UUID |
| `studentGroupId` | Yes | Class UUID |

---

### `GET /api/calculations/class-summary`

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
