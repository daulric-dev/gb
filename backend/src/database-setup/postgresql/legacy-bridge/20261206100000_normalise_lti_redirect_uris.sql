-- Registered OIDC redirect URIs are a set with membership checks, so store
-- them as rows instead of a PostgreSQL text array.
CREATE TABLE public.lti_tool_redirect_uri (
    tool_id uuid NOT NULL,
    redirect_uri text NOT NULL,
    CONSTRAINT lti_tool_redirect_uri_pkey PRIMARY KEY (tool_id, redirect_uri),
    CONSTRAINT lti_tool_redirect_uri_tool_fkey FOREIGN KEY (tool_id)
        REFERENCES public.lti_tool(id) ON DELETE CASCADE
);

INSERT INTO public.lti_tool_redirect_uri (tool_id, redirect_uri)
SELECT DISTINCT tool.id, selected.redirect_uri
FROM public.lti_tool AS tool
CROSS JOIN LATERAL unnest(tool.redirect_uris) AS selected(redirect_uri);

ALTER TABLE public.lti_tool DROP COLUMN redirect_uris;
