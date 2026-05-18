-- Rename existing gradingmodel enum values and add continuous_cumulative
-- This replaces the old term_based/year_based with the new grading system names.

ALTER TYPE public.gradingmodel RENAME VALUE 'term_based' TO 'weighted_continuous';
ALTER TYPE public.gradingmodel RENAME VALUE 'year_based' TO 'weighted_cumulative';
ALTER TYPE public.gradingmodel ADD VALUE IF NOT EXISTS 'continuous_cumulative';
