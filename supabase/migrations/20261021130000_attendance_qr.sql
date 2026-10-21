-- QR check-in for attendance.
--
-- The teacher's screen shows a QR code that changes every few seconds. Each
-- frame carries a token derived from a per-session secret and the current
-- time window, so a photo of the code sent to someone outside the room stops
-- working almost at once. The secret never leaves the server.
--
-- Sessions opened before this migration have no secret and simply offer no
-- QR code.

ALTER TABLE "course"."attendance_session"
  ADD COLUMN IF NOT EXISTS "qr_secret" "text";

-- Lets the teacher see who came in by scanning rather than typing the code.
ALTER TYPE "course"."attendance_method" ADD VALUE IF NOT EXISTS 'qr';
