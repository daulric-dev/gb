-- AI course builder (src/ai, ai-course.service.ts), behind the ai_assistance
-- feature. Teachers draft a course outline, module items, page content,
-- assignment instructions, rubrics, announcements and learning outcomes from
-- their own material (no student data is sent). Each request is logged in
-- public.ai_request like the other AI features: the only schema change is
-- allowing the new feature names in its check constraint. Nothing else is
-- stored: a reviewed plan is created through the existing course, grading
-- and mastery tables, unpublished.

ALTER TABLE public.ai_request DROP CONSTRAINT ai_request_feature_check;
ALTER TABLE public.ai_request ADD CONSTRAINT ai_request_feature_check CHECK (feature IN (
  'quiz_questions',
  'rubric_feedback',
  'page_summary',
  'course_outline',
  'module_items',
  'page_content',
  'assignment_instructions',
  'rubric_draft',
  'announcement_draft',
  'outcome_suggestions',
  'test'
));
