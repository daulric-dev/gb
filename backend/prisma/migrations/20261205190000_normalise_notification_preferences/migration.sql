-- Store notification opt-outs as rows so the preference model does not rely
-- on PostgreSQL scalar arrays. Copy the existing choices before removing the
-- array columns.
CREATE TABLE public.notification_preference_opt_out (
    user_profile_id uuid NOT NULL,
    channel text NOT NULL,
    category text NOT NULL,
    CONSTRAINT notification_preference_opt_out_pkey PRIMARY KEY (user_profile_id, channel, category),
    CONSTRAINT notification_preference_opt_out_user_fkey FOREIGN KEY (user_profile_id)
        REFERENCES public.user_profile(id) ON DELETE CASCADE,
    CONSTRAINT notification_preference_opt_out_channel_check CHECK (channel IN ('push', 'email')),
    CONSTRAINT notification_preference_opt_out_category_check CHECK (
        category IN ('announcements', 'coursework', 'grades', 'discussions', 'attendance', 'chat')
    )
);

INSERT INTO public.notification_preference_opt_out (user_profile_id, channel, category)
SELECT DISTINCT preference.user_profile_id, 'push', opt_out.category
FROM public.notification_preference AS preference
CROSS JOIN LATERAL unnest(preference.push_off) AS opt_out(category);

INSERT INTO public.notification_preference_opt_out (user_profile_id, channel, category)
SELECT DISTINCT preference.user_profile_id, 'email', opt_out.category
FROM public.notification_preference AS preference
CROSS JOIN LATERAL unnest(preference.email_off) AS opt_out(category);

CREATE INDEX notification_preference_opt_out_lookup_idx
    ON public.notification_preference_opt_out (channel, category, user_profile_id);

ALTER TABLE public.notification_preference
    DROP CONSTRAINT notification_preference_push_off_check,
    DROP CONSTRAINT notification_preference_email_off_check,
    DROP COLUMN push_off,
    DROP COLUMN email_off;
