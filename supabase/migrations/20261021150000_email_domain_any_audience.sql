-- One domain for everyone. Plenty of schools give students and teachers
-- addresses on the same domain (srmss.edu.gd for both), which the
-- student-or-staff choice could not express: the domain can only be listed
-- once. 'any' matches both kinds of account - students join as students,
-- staff follow the domain's auto_join / staff_role like a staff domain.
--
-- The join RPC still receives the resolved 'student' or 'staff'; 'any' is
-- only ever stored on the domain.
ALTER TYPE "public"."email_domain_audience" ADD VALUE IF NOT EXISTS 'any';
