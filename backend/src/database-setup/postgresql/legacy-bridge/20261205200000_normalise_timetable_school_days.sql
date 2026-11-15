-- Store a school's open weekdays as one row per day instead of a PostgreSQL
-- smallint array. Copy the existing schedule before dropping the array.
CREATE TABLE public.timetable_school_day (
    school_id uuid NOT NULL,
    weekday smallint NOT NULL,
    CONSTRAINT timetable_school_day_pkey PRIMARY KEY (school_id, weekday),
    CONSTRAINT timetable_school_day_school_fkey FOREIGN KEY (school_id)
        REFERENCES public.timetable_setting(school_id) ON DELETE CASCADE,
    CONSTRAINT timetable_school_day_weekday_check CHECK (weekday BETWEEN 1 AND 7)
);

INSERT INTO public.timetable_school_day (school_id, weekday)
SELECT DISTINCT setting.school_id, open_day.weekday
FROM public.timetable_setting AS setting
CROSS JOIN LATERAL unnest(setting.school_days) AS open_day(weekday);

ALTER TABLE public.timetable_setting
    DROP CONSTRAINT timetable_setting_school_days_check,
    DROP COLUMN school_days;
