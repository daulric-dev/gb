# Grade scale DTOs (`src/grade-scale/dto`)

Request bodies for the write routes in `grade-scale.controller.ts`. They are validated by the global `ValidationPipe`. The service then checks the band rules: `min <= max`, no overlaps, and unique labels.

| File | Defines | Used by | Validation |
| --- | --- | --- | --- |
| `create-grade-scale.dto.ts` | `CreateGradeScaleDto`, `GRADE_SCALE_TYPES`, `GradeScaleType` | `POST /api/grade-scales` | `name`: non-empty, at most 100. `scaleType`: `letter`, `gpa` or `pass_fail`. `isDefault`: optional boolean. `bands`: at least 1 `BandInputDto`, validated as nested objects. |
| `update-grade-scale.dto.ts` | `UpdateGradeScaleDto` | `PATCH /api/grade-scales/:id` | `name`: optional, at most 100. `isDefault`: optional boolean. The scale type cannot be changed. |
| `replace-bands.dto.ts` | `ReplaceBandsDto` | `PUT /api/grade-scales/:id/bands` | `bands`: at least 1 `BandInputDto` |
| `band-input.dto.ts` | `BandInputDto` | nested in the create and replace-bands DTOs | `label`: non-empty, at most 20. `minPercentage` and `maxPercentage`: 0 to 100. `gpaPoints`: optional, 0 to 10. `isPass`: boolean. `sortOrder`: optional int (defaults to the band's index). |

`GradeScaleType` is also imported by `../transformer.ts` and `../grade-scale.service.ts`.

## Adding a DTO

Create `<name>.dto.ts` with class-validator rules. Nested arrays need `@ValidateNested({ each: true })` together with `@Type(() => ...)`. Use the DTO as the `@Body()` type in the controller, and put any rule that spans several fields (like band overlap) in `GradeScaleService`.
