-- Store parent notice choices as rows instead of a PostgreSQL text array.
CREATE TABLE student.parent_notification_kind (
    user_profile_id uuid NOT NULL,
    kind text NOT NULL,
    CONSTRAINT parent_notification_kind_pkey PRIMARY KEY (user_profile_id, kind),
    CONSTRAINT parent_notification_kind_user_fkey FOREIGN KEY (user_profile_id)
        REFERENCES student.parent_notification_pref(user_profile_id) ON DELETE CASCADE,
    CONSTRAINT parent_notification_kind_check CHECK (
        kind IN ('missing_work', 'absence', 'new_grade', 'announcement', 'attendance_alert')
    )
);

INSERT INTO student.parent_notification_kind (user_profile_id, kind)
SELECT preference.user_profile_id, selected.kind
FROM student.parent_notification_pref AS preference
CROSS JOIN LATERAL unnest(preference.kinds) AS selected(kind);

ALTER TABLE student.parent_notification_pref
    DROP CONSTRAINT parent_notification_pref_kinds_check,
    DROP COLUMN kinds;
