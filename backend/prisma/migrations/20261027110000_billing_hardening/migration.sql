-- Billing hardening.
--
-- * subscription.pending_checkout_id: the hosted checkout session last
--   started for the school. A new checkout expires it first, so two parallel
--   checkouts cannot both turn into subscriptions.
-- * subscription.last_event_at: creation time of the newest provider event
--   applied to the subscription. Older events delivered late are ignored.
-- * payment_event.processing_at: a worker's claim on an event. Concurrent
--   deliveries of the same event cannot both apply it; a claim older than
--   5 minutes (a crashed worker) may be taken over.
-- * job_lease: a time-limited lease per background job, replacing the
--   advisory lock that pinned a transaction for the whole hourly sweep.

--
-- Name: subscription; Type: TABLE; Schema: billing; Owner: -
--

ALTER TABLE billing.subscription
    ADD COLUMN pending_checkout_id text,
    ADD COLUMN last_event_at timestamp(6) with time zone;


--
-- Name: payment_event; Type: TABLE; Schema: billing; Owner: -
--

ALTER TABLE billing.payment_event
    ADD COLUMN processing_at timestamp(6) with time zone;


--
-- Name: job_lease; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.job_lease (
    name text NOT NULL,
    holder text NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    CONSTRAINT job_lease_pkey PRIMARY KEY (name)
);
