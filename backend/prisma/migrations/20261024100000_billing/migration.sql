-- Billing for the hosted platform: schools pay for GradeBook.
--
-- Everything lives in its own `billing` schema and is only read or written
-- when the API runs with BILLING_ENABLED=true. Self-hosted deployments leave
-- it off and these tables stay empty.
--
-- subscription      one row per school: plan, status, provider references,
--                   trial and paid-through dates, complimentary access.
-- invoice           what a school owes or paid, one per billing period.
-- payment_event     every provider webhook we processed, for idempotency.
-- provider_setting  a platform admin's on/off switch per payment provider.
-- platform_admin    who may use the platform (operator) dashboard.

--
-- Name: billing; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS billing;


--
-- Name: subscription; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.subscription (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    plan text,
    status text DEFAULT 'trialing'::text NOT NULL,
    provider text,
    provider_customer_id text,
    provider_subscription_id text,
    quantity integer DEFAULT 1 NOT NULL,
    trial_ends_at timestamp(6) with time zone,
    current_period_start timestamp(6) with time zone,
    current_period_end timestamp(6) with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    comp_until timestamp(6) with time zone,
    comp_note text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT subscription_pkey PRIMARY KEY (id),
    CONSTRAINT subscription_plan_check CHECK ((plan IS NULL) OR (plan = ANY (ARRAY['per_user'::text, 'flat'::text]))),
    CONSTRAINT subscription_status_check CHECK ((status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'unpaid'::text, 'incomplete'::text]))),
    CONSTRAINT subscription_quantity_check CHECK ((quantity >= 1))
);


--
-- Name: invoice; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.invoice (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    school_id uuid NOT NULL,
    plan text NOT NULL,
    seats integer NOT NULL,
    amount_cents integer NOT NULL,
    currency text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    provider text,
    provider_invoice_id text,
    period_start timestamp(6) with time zone NOT NULL,
    period_end timestamp(6) with time zone NOT NULL,
    due_at timestamp(6) with time zone NOT NULL,
    paid_at timestamp(6) with time zone,
    method text,
    reference text,
    note text,
    marked_by uuid,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT invoice_pkey PRIMARY KEY (id),
    CONSTRAINT invoice_plan_check CHECK ((plan = ANY (ARRAY['per_user'::text, 'flat'::text]))),
    CONSTRAINT invoice_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paid'::text, 'void'::text, 'uncollectible'::text]))),
    CONSTRAINT invoice_amount_check CHECK ((amount_cents >= 0)),
    CONSTRAINT invoice_seats_check CHECK ((seats >= 1))
);


--
-- Name: payment_event; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.payment_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    type text NOT NULL,
    school_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp(6) with time zone,
    error text,
    CONSTRAINT payment_event_pkey PRIMARY KEY (id)
);


--
-- Name: provider_setting; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.provider_setting (
    provider_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT provider_setting_pkey PRIMARY KEY (provider_id)
);


--
-- Name: platform_admin; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.platform_admin (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    note text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT platform_admin_pkey PRIMARY KEY (id)
);


--
-- Name: indexes; Type: INDEX; Schema: billing; Owner: -
--

CREATE UNIQUE INDEX subscription_school_id_key ON billing.subscription USING btree (school_id);

CREATE INDEX subscription_provider_idx ON billing.subscription USING btree (provider);

-- A provider's subscription id belongs to one school. NULLs (no subscription
-- yet, or an invoice-mode provider) never collide.
CREATE UNIQUE INDEX subscription_provider_subscription_key ON billing.subscription USING btree (provider, provider_subscription_id);

CREATE UNIQUE INDEX invoice_number_key ON billing.invoice USING btree (number);

CREATE INDEX invoice_school_id_created_at_idx ON billing.invoice USING btree (school_id, created_at DESC);

CREATE INDEX invoice_status_due_at_idx ON billing.invoice USING btree (status, due_at);

CREATE INDEX invoice_marked_by_idx ON billing.invoice USING btree (marked_by);

CREATE UNIQUE INDEX invoice_provider_invoice_key ON billing.invoice USING btree (provider, provider_invoice_id);

-- One live invoice of ours per school and billing period: the invoice sweep
-- can run on several API instances at once without billing anyone twice.
-- Invoices a subscription provider raised (provider_invoice_id set, e.g.
-- prorations) are history only and may share a period.
CREATE UNIQUE INDEX invoice_school_period_key ON billing.invoice USING btree (school_id, period_start) WHERE ((status <> 'void'::text) AND (provider_invoice_id IS NULL));

CREATE INDEX payment_event_school_id_created_at_idx ON billing.payment_event USING btree (school_id, created_at DESC);

-- Webhook idempotency: a provider's event is applied once.
CREATE UNIQUE INDEX payment_event_provider_event_id_key ON billing.payment_event USING btree (provider, event_id);

CREATE UNIQUE INDEX platform_admin_user_id_key ON billing.platform_admin USING btree (user_id);


--
-- Name: foreign keys; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.subscription
    ADD CONSTRAINT subscription_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;

ALTER TABLE ONLY billing.invoice
    ADD CONSTRAINT invoice_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;

ALTER TABLE ONLY billing.invoice
    ADD CONSTRAINT invoice_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES account.app_user(id) ON DELETE SET NULL;

ALTER TABLE ONLY billing.payment_event
    ADD CONSTRAINT payment_event_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE SET NULL;

ALTER TABLE ONLY billing.platform_admin
    ADD CONSTRAINT platform_admin_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.app_user(id) ON DELETE CASCADE;
