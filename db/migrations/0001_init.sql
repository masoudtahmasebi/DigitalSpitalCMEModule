-- Schema v1 (P0-04), implementing ADR-0002.
--
-- Run as ds_migrator, which owns everything here. The application connects as
-- ds_app, which is not BYPASSRLS and owns nothing.
--
-- TENANT ISOLATION
--
-- customer_id is denormalised onto every tenant-scoped table, including deeply
-- nested ones where it is derivable by joining upward. That is deliberate: it
-- lets every table carry the IDENTICAL policy expression, which is reviewable
-- at a glance. A per-table policy with a three-join subquery would be both slow
-- and a fresh opportunity to write it wrong on each table.
--
-- Every such table gets ENABLE plus FORCE row level security. FORCE is not
-- optional: table owners bypass RLS by default, so without it an environment
-- where the app role happened to own a table would silently have no isolation.
--
-- CONVENTIONS
--
--   * timestamptz everywhere, always UTC. German local time is presentation.
--   * percentages are integers 0-100, never floats.
--   * identifiers are snake_case here and camelCase in TypeScript; the Drizzle
--     schema is the single mapping point.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================================================
-- Hierarchy: Customer -> Department -> Project -> Course -> Module -> Chapter
-- ===========================================================================

CREATE TABLE customers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Departments exist so that MEDICE's therapeutic areas get per-area admin
-- scoping and reporting without each becoming a separate customer, which would
-- break billing and admin access (roadmap section 3).
CREATE TABLE departments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    slug        text NOT NULL,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Scoped to the parent, not global: two customers may both have "ADHS".
    UNIQUE (customer_id, slug)
);

-- Project holds SMTP, branding and the Keycloak binding (roadmap section 3).
CREATE TABLE projects (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id          uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    department_id        uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    slug                 text NOT NULL,
    name                 text NOT NULL,

    keycloak_issuer      text,
    keycloak_audience    text,
    keycloak_realm       text,

    branding             jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Write-only, encrypted at rest with the application KMS key. Never
    -- returned by any endpoint at any role (CLAUDE.md section 4 invariant 7).
    smtp_host            text,
    smtp_port            integer,
    smtp_username        text,
    smtp_password_enc    bytea,
    smtp_from_address    text,
    smtp_from_name       text,

    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (department_id, slug)
);

CREATE TYPE course_delivery_type AS ENUM ('on_demand', 'live', 'praesenz');

-- Course holds every compliance setting.
CREATE TABLE courses (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id             uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    project_id              uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    slug                    text NOT NULL,
    title                   text NOT NULL,
    description             text,

    -- The list screen's three tabs. Only on_demand is populated for launch;
    -- live and praesenz need event scheduling that is not in the 140 h
    -- (docs/requirements/medice-adhs.md section 6.3).
    delivery_type           course_delivery_type NOT NULL DEFAULT 'on_demand',

    -- Facets behind the Thema / Altersgruppe filters.
    thema                   text[] NOT NULL DEFAULT '{}',
    altersgruppe            text[] NOT NULL DEFAULT '{}',

    -- Accreditation. VNR and its password are issued together per course by the
    -- Ärztekammer on approval.
    vnr                     text,
    vnr_password_enc        bytea,
    fortbildungsnummer      text,
    accreditation_body      text,
    cme_points              integer CHECK (cme_points IS NULL OR cme_points > 0),
    cme_category            text,
    event_location          text,
    organizer               text,
    valid_from              timestamptz,
    valid_to                timestamptz,

    -- Configurable per course precisely because the layout says 80 % and
    -- MEDICE-292 says 100 %. The system takes no position; the record does.
    required_watch_percent  integer NOT NULL DEFAULT 100
        CHECK (required_watch_percent BETWEEN 0 AND 100),
    pass_threshold_percent  integer NOT NULL DEFAULT 70
        CHECK (pass_threshold_percent BETWEEN 0 AND 100),
    -- NULL means unlimited, which is the MEDICE configuration.
    max_quiz_attempts       integer CHECK (max_quiz_attempts IS NULL OR max_quiz_attempts > 0),
    -- Never true for a CME-certified course.
    reveal_correct_answers  boolean NOT NULL DEFAULT false,

    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    UNIQUE (project_id, slug),
    CONSTRAINT valid_window_ordered
        CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to)
);

CREATE TABLE modules (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    ordinal     integer NOT NULL,
    title       text NOT NULL,
    subtitle    text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Ordinals define sequential gating (P3-03), so a duplicate would be a
    -- gating bug that presents as a content bug.
    UNIQUE (course_id, ordinal)
);

CREATE TABLE chapters (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    module_id   uuid NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
    ordinal     integer NOT NULL,
    title       text NOT NULL,
    body        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (module_id, ordinal)
);

CREATE TYPE content_kind AS ENUM ('video', 'text', 'quiz', 'details', 'material');

CREATE TABLE contents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    chapter_id    uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
    ordinal       integer NOT NULL,
    kind          content_kind NOT NULL,
    title         text NOT NULL,
    body          text,
    video_url     text,
    -- Without a duration the watch gate cannot be evaluated at all, so video
    -- content must carry one.
    duration_sec  integer CHECK (duration_sec IS NULL OR duration_sec > 0),
    -- Mediathek downloads (docs/requirements/medice-adhs.md section 4.2).
    file_url      text,
    file_size     bigint,
    mime_type     text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (chapter_id, ordinal),
    CONSTRAINT video_needs_duration
        CHECK (kind <> 'video' OR duration_sec IS NOT NULL)
);

-- Experten/Referenten tab.
CREATE TABLE course_experts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    ordinal      integer NOT NULL,
    role_label   text NOT NULL,
    name         text NOT NULL,
    institution  text,
    biography    text,
    photo_url    text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (course_id, ordinal)
);

-- ===========================================================================
-- Users, EFN
-- ===========================================================================

-- Keycloak `sub` is the primary key, scoped by realm. Email is a documented,
-- audited fallback only: a physician who changes name after marriage keeps one
-- CME record rather than splitting into two identities (ADR-0003).
CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_realm text NOT NULL,
    keycloak_sub   text NOT NULL,
    email          text,
    first_name     text,
    last_name      text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (keycloak_realm, keycloak_sub)
);

-- One EFN per person, not per enrolment. Divergent EFNs across courses would
-- let a submission credit the wrong physician's account, which looks like
-- success and is the worst failure available (ADR-0004).
CREATE TABLE efn_profiles (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    efn         text NOT NULL CHECK (efn ~ '^[0-9]{15}$'),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE app_role AS ENUM ('super_admin', 'customer_admin', 'department_admin', 'learner');

-- Roles are checked against local assignment, never taken from the token alone,
-- so a crafted claim cannot escalate (P1-04).
CREATE TABLE user_roles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          app_role NOT NULL,
    customer_id   uuid REFERENCES customers(id) ON DELETE CASCADE,
    department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, role, customer_id, department_id)
);

-- ===========================================================================
-- Enrolment and progress
-- ===========================================================================

-- The snapshot columns pin the compliance settings in force at enrolment, so a
-- later threshold change cannot retroactively invalidate work already done.
CREATE TABLE enrolments (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id                 uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    course_id                   uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    required_watch_percent      integer NOT NULL CHECK (required_watch_percent BETWEEN 0 AND 100),
    pass_threshold_percent      integer NOT NULL CHECK (pass_threshold_percent BETWEEN 0 AND 100),
    max_quiz_attempts           integer,
    cme_points                  integer,
    cme_category                text,
    vnr                         text,

    last_content_id             uuid REFERENCES contents(id) ON DELETE SET NULL,
    completed_at                timestamptz,
    -- The name the learner attested to at submission time, which may differ
    -- from the Keycloak profile (docs/requirements/medice-adhs.md section 1).
    attested_name               text,

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (course_id, user_id)
);

CREATE TYPE progress_status AS ENUM ('not_started', 'in_progress', 'completed');

CREATE TABLE content_progress (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    enrolment_id     uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    content_id       uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,

    status           progress_status NOT NULL DEFAULT 'not_started',
    -- Server-computed from watched_segments. A client-supplied percentage is
    -- ignored entirely (P3-02).
    watched_percent  integer NOT NULL DEFAULT 0 CHECK (watched_percent BETWEEN 0 AND 100),
    -- Disjoint [start, end] intervals. The UNION of these is the coverage;
    -- the maximum position is not, and never is (CLAUDE.md invariant 5).
    watched_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
    last_position_sec integer NOT NULL DEFAULT 0,
    score_percent    integer CHECK (score_percent IS NULL OR score_percent BETWEEN 0 AND 100),

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (enrolment_id, content_id)
);

-- ===========================================================================
-- Assessment
-- ===========================================================================

CREATE TYPE question_kind AS ENUM ('single', 'multi');

CREATE TABLE quiz_questions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    content_id  uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
    ordinal     integer NOT NULL,
    kind        question_kind NOT NULL DEFAULT 'single',
    prompt      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (content_id, ordinal)
);

-- is_correct never leaves the server for a CME-certified course. The learner
-- endpoint projects a schema with no field capable of carrying it (P4-01).
CREATE TABLE quiz_options (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    question_id uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    ordinal     integer NOT NULL,
    label       text NOT NULL,
    is_correct  boolean NOT NULL DEFAULT false,
    UNIQUE (question_id, ordinal)
);

CREATE TABLE quiz_attempts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    enrolment_id   uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    content_id     uuid NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
    attempt_number integer NOT NULL CHECK (attempt_number > 0),
    correct_count  integer NOT NULL DEFAULT 0,
    total_count    integer NOT NULL DEFAULT 0,
    score_percent  integer NOT NULL DEFAULT 0 CHECK (score_percent BETWEEN 0 AND 100),
    passed         boolean NOT NULL DEFAULT false,
    submitted_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (enrolment_id, content_id, attempt_number)
);

CREATE TABLE quiz_answers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    attempt_id   uuid NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id  uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE RESTRICT,
    selected_option_ids uuid[] NOT NULL DEFAULT '{}',
    is_correct   boolean NOT NULL,
    UNIQUE (attempt_id, question_id)
);

-- Evaluationsbogen
CREATE TABLE evaluations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    ordinal     integer NOT NULL,
    prompt      text NOT NULL,
    kind        text NOT NULL,
    required    boolean NOT NULL DEFAULT true,
    options     jsonb NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE (course_id, ordinal)
);

CREATE TABLE evaluation_responses (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    enrolment_id  uuid NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE RESTRICT,
    -- Personal data. Never logged, never in an error payload.
    answer        jsonb NOT NULL,
    submitted_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (enrolment_id, evaluation_id)
);

-- ===========================================================================
-- Compliance output: EIV submissions and certificates
-- ===========================================================================

CREATE TYPE eiv_status AS ENUM (
    'queued', 'held', 'submitted', 'failed_retryable', 'failed_permanent', 'window_closed'
);

CREATE TABLE eiv_submissions (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id              uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    enrolment_id             uuid NOT NULL REFERENCES enrolments(id) ON DELETE RESTRICT,

    vnr                      text NOT NULL,
    efn                      text NOT NULL CHECK (efn ~ '^[0-9]{15}$'),
    rolle                    text NOT NULL DEFAULT 'TEILNEHMER',

    status                   eiv_status NOT NULL DEFAULT 'queued',
    attempt_count            integer NOT NULL DEFAULT 0,
    external_reference       text,

    event_end_at             timestamptz NOT NULL,
    report_due_at            timestamptz NOT NULL,
    first_submitted_at       timestamptz,
    correction_window_ends_at timestamptz,
    next_attempt_at          timestamptz,
    last_error               text,

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    -- Each completion submits exactly once, even under concurrent triggers.
    UNIQUE (enrolment_id)
);

CREATE TYPE certificate_status AS ENUM ('pending', 'issued', 'delivered', 'bounced');

CREATE TABLE certificates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    enrolment_id  uuid NOT NULL REFERENCES enrolments(id) ON DELETE RESTRICT,
    status        certificate_status NOT NULL DEFAULT 'pending',
    -- Not enumerable: a certificate URL must not disclose another learner's
    -- existence (P8-04).
    download_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    participant_name text NOT NULL,
    issued_at     timestamptz,
    delivered_at  timestamptz,
    delivery_error text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (enrolment_id)
);

-- ===========================================================================
-- Audit log — append only
-- ===========================================================================

CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    customer_id uuid,
    actor_id    uuid,
    action      text NOT NULL,
    subject     text,
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- An audit trail that can be edited is not an audit trail. Enforced at the
-- database, so no application bug or generated repository method can weaken it.
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ===========================================================================
-- Indexes
-- ===========================================================================

CREATE INDEX ON departments (customer_id);
CREATE INDEX ON projects (customer_id, department_id);
CREATE INDEX ON courses (customer_id, project_id);
CREATE INDEX ON modules (customer_id, course_id, ordinal);
CREATE INDEX ON chapters (customer_id, module_id, ordinal);
CREATE INDEX ON contents (customer_id, chapter_id, ordinal);
CREATE INDEX ON course_experts (customer_id, course_id, ordinal);
CREATE INDEX ON enrolments (customer_id, user_id);
CREATE INDEX ON content_progress (customer_id, enrolment_id);
CREATE INDEX ON quiz_questions (customer_id, content_id, ordinal);
CREATE INDEX ON quiz_attempts (customer_id, enrolment_id);
CREATE INDEX ON eiv_submissions (status, next_attempt_at);
CREATE INDEX ON eiv_submissions (customer_id);
CREATE INDEX ON certificates (customer_id, status);
CREATE INDEX ON audit_log (customer_id, created_at DESC);

-- ===========================================================================
-- Row-level security
--
-- One policy shape, repeated verbatim, on every tenant-scoped table. The
-- WITH CHECK half is what makes a cross-tenant INSERT fail at the database
-- rather than relying on application code to have filtered correctly.
--
-- current_setting(..., true) returns NULL when unset, so an unset tenant
-- context matches nothing: the system fails closed.
-- ===========================================================================

DO $$
DECLARE
    t text;
    tenant_tables text[] := ARRAY[
        'customers', 'departments', 'projects', 'courses', 'modules', 'chapters',
        'contents', 'course_experts', 'enrolments', 'content_progress',
        'quiz_questions', 'quiz_options', 'quiz_attempts', 'quiz_answers',
        'evaluations', 'evaluation_responses', 'eiv_submissions', 'certificates'
    ];
    tenant_column text;
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        -- `customers` keys on its own id; everything else carries customer_id.
        tenant_column := CASE WHEN t = 'customers' THEN 'id' ELSE 'customer_id' END;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format($f$
            CREATE POLICY %1$I_tenant_isolation ON %1$I
              USING (%2$I = current_setting('app.customer_id', true)::uuid)
              WITH CHECK (%2$I = current_setting('app.customer_id', true)::uuid)
        $f$, t, tenant_column);
    END LOOP;
END
$$;

-- Users and their EFN are not customer-scoped: one physician may hold
-- enrolments across customers, and splitting them would fragment the CME
-- record. Access is mediated by the API's own-record checks (P1-06), and the
-- enrolments that reference them are tenant-isolated above.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (
    customer_id IS NULL
    OR customer_id = current_setting('app.customer_id', true)::uuid
  )
  WITH CHECK (
    customer_id IS NULL
    OR customer_id = current_setting('app.customer_id', true)::uuid
  );

COMMIT;
