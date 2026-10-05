---
name: brainstorming
description: Use when the person asks to build, add, change or remove behaviour in this repository — a feature, a screen, an endpoint, a rule, a migration — and no approved ticket in docs/backlog/ already specifies it. Classifies the request (spike, bounded, architectural), asks one question at a time, runs the CLAUDE.md checks that can stop a design, and ends in an approved ticket before any code. Not for questions, reviews, audits, explanations, or work an approved ticket already covers.
license: MIT
---

# Brainstorming a request into an agreed design

Adapted from Superpowers by Jesse Vincent (MIT, commit `8ca22db`); what was
changed and why is in `.claude/skills/THIRD-PARTY.md`. **CLAUDE.md wins every
conflict with this file.**

This skill exists because the expensive failure on this project is not a bug,
it is building the wrong thing: a session that delivers something nobody asked
for, and then argues its way back. One clarifying question before the work is
cheaper than an hour of "no, that's not what I meant". On this platform the cost
is higher than usual — every feature has to keep working under tenant
isolation, locale copy, with compliance consequences (CLAUDE.md §3).

## Establish shared understanding

1. **Discover intent.** From the request and context, identify the outcome,
   who it is for (learner, operator, customer admin, the Ärztekammer), and what
   success looks like. When that is missing, ask one focused question about
   purpose before proposing features or an approach.
2. **Write back your understanding.** Summarise the outcome, constraints and
   success criteria in a short note the person can correct. Separate what they
   said from what you are assuming. Incorporate their correction before
   treating it as the brief.
3. **Carry intent into the design.** Check every proposed feature and technical
   choice against that understanding.

When the request already supplies purpose and constraints, reflect them back
rather than asking again.

## The hard gate

Before any implementation action — writing product code, scaffolding, adding a
dependency, a migration — complete the selected path's prerequisites:

- **Spike:** the person approves the question and the probe.
- **Bounded:** the person approves the short in-chat design.
- **Architectural:** the person approves the design, then reviews the written
  ticket, then reviews the plan `/writing-plans` adds to it.

A reply approves the stage actually presented, and nothing after it. Read-only
exploration of the repository is always allowed.

## Three paths

Before your first question, classify the request and say so out loud — "this
looks bounded, so I'll present a short design here" — so the person can
override it.

- **Spike** — a feasibility question whose output is an answer, not code you
  keep. State the question and the probe in 2–3 sentences, get a nod, find out
  as cheaply as correctness allows, report a recommendation. Anything built is
  throwaway and is **not committed**.
- **Bounded** — a well-scoped change to a flow that already exists in this
  repository and can be read: a new field, a small endpoint, a one-file fix.
  Ask the questions that matter, present a short design in chat, and **stop**
  until you hear yes.
- **Architectural** — a new subsystem, a new table, a change to how components
  fit together, or to an interface others depend on (`contracts/openapi.yaml`,
  `@ds/domain` exports, the `<ds-lms>` element's attributes, the WordPress
  plugin). Questions, 2–3 approaches, a sectioned design, then the ticket, then
  `/writing-plans`.

When in doubt, take the heavier path. Hidden complexity found mid-task upgrades
the path — stop and say so. Nothing downgrades mid-task.

## The project checks — run during the design, not after

These are the questions this repository has already paid for. Each one can
**stop** the design rather than shape it.

| Check                                                                                                                                                                                                                                           | If it applies                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does it need anything on the deferred list in CLAUDE.md §3 (Storyblok, Vue wrapper, analytics/charts, exports beyond CSV, SCORM/xAPI, gamification, self-service signup/billing, Salesforce, WYSIWYG, transcoding, second-customer onboarding)? | **Stop and flag it.** It is the client's decision, in a ticket, never absorbed.                                                                              |
| Is the EIV contract, an accreditation rule, the CME point calculation or certificate content ambiguous? (§7)                                                                                                                                    | **Stop.** Raise it in `docs/show-stoppers.md` with an owner. Do not design around an invented rule.                                                          |
| Does it touch auth, assessment, eiv or certificates? (§2)                                                                                                                                                                                       | The ticket carries **Review gate: human**.                                                                                                                   |
| Does it decide anything that affects a CME point? (§4.1, §4.4)                                                                                                                                                                                  | The decision lives in `packages/domain`, pure, and the API calls it. Name the caller (§9.3, §9.7).                                                           |
| Does it read a value an operator can edit? (§9.10b)                                                                                                                                                                                             | Name the one home of that value. A second reader is the defect.                                                                                              |
| Does it add or read a tenant-scoped table? (§4.3, §9.6)                                                                                                                                                                                         | RLS policy, `customer_id`, reads inside `runInTenant`, and a cross-tenant test that expects zero rows.                                                       |
| Does the API surface change? (§2 contract-first)                                                                                                                                                                                                | `contracts/openapi.yaml` changes first; the SDK is regenerated from it.                                                                                      |
| Does a person see it? (§5, §9.2, §9.4, §9.8)                                                                                                                                                                                                    | Copy in `apps/widget/src/locale/`, never inline; never offer a control the API refuses; the screen says what the person does next; the state has an address. |
| Does it touch personal data? (§8)                                                                                                                                                                                                               | `docs/gdpr.md` §2 and §4 change with it.                                                                                                                     |

## Checklist

Classify, announce the path, then work through its list in order.

**Spike:** explore enough to frame the probe → present question and probe →
get a nod → investigate → report a recommendation, labelling anything built as
throwaway.

**Bounded:**

1. Explore the code, docs and `git log` for the flow being changed.
2. Ask clarifying questions, one per message, the ones that matter.
3. Present a short design in chat: approach, files touched, the test that will
   go red first, and any project check above that applies.
4. **Stop** and wait for an explicit yes.
5. Write the ticket (below), short: Context, Scope, Acceptance criteria.
   CLAUDE.md §2: no ticket, no code. Then implement — failing case first
   (CLAUDE.md §11.6).

**Architectural:**

1. Explore the code, `docs/architecture.md`, the ADRs and `git log`.
2. Ask clarifying questions, one per message. Prefer multiple choice.
3. Propose 2–3 approaches with trade-offs, recommended one first.
4. Present the design in sections scaled to their complexity — architecture,
   data and tenant boundaries, data flow, error handling (problem-details),
   copy, testing — and ask after each whether it looks right.
5. Write the ticket (below).
6. Self-review the ticket (below).
7. Ask the person to review the ticket file before planning.
8. Hand over to `/writing-plans`. No other skill comes next.

## The ticket is the spec

There is no separate design document. The agreed design becomes the ticket
in `docs/backlog/`, because that is where this repository keeps its work orders
and a second home for the same decision would be the §9.10b defect.

- **Number:** run `git fetch origin main` and take the next number free on
  `origin/main`, not in the local checkout — two sessions picking the same
  number is how P160-01 and P243/P244 happened. `pnpm check:backlog` must stay
  green.
- **Shape:** match the recent files in `docs/backlog/`: a `# P<N> — title`
  heading, **Raised by:** with the person's words quoted, then one `## P<N>-01 — …`
  section per task carrying **Context**, **Scope**, **Acceptance criteria**
  (checkboxes), **Review gate**, and **Not in scope**. Record the approaches
  you rejected and why, briefly, under Context. No hour estimates — the budget
  was withdrawn (CLAUDE.md §3).
- **Every claim labelled** `Verified:` with the command, or `Assumed:`
  (CLAUDE.md §11.3).
- Write the file; do not commit it until the person has approved it.

### Self-review of the ticket

1. **Placeholders:** any "TBD", "TODO", "handle edge cases", or a vague
   criterion? Make it concrete.
2. **Consistency:** do sections contradict each other?
3. **Scope:** is this one ticket, or several independent ones?
4. **Ambiguity:** could a criterion be read two ways? Pick one, say which.
5. **Can each criterion go red?** A criterion nobody could fail is not one
   (§9.1).

Fix inline, then ask for review:

> "The ticket is at `docs/backlog/P<N>.md`. Please review it — once you're
> happy, I'll add the implementation plan with `/writing-plans`."

## Red flags

| Thought                                                  | Reality                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| "Too simple to need a design"                            | A bounded change gets two sentences in chat. It still gets them.                                        |
| "I'll call it bounded and skip the ticket"               | Reaching for a label to skip work is the doubt — take the heavier path.                                 |
| "The design is obvious, I'll start while they read it"   | The gate is the approval, not the design's length.                                                      |
| "The spike works, so I'll keep the code"                 | A spike's output is an answer. Keeping the code is a new request.                                       |
| "The rule is probably X"                                 | On EIV, accreditation, points or certificates: stop and ask (§7).                                       |
| "It's only a small extra the client will obviously want" | §3: a feature nobody asked for still costs tenant isolation, tests, copy and someone at 22:00. Flag it. |

## Design for isolation, in the existing codebase

- Explore before proposing. Follow the existing patterns — `fromDb(db)`
  services, `runInTenant`, `AppError` problem-details, the locale file.
- Units with one clear purpose and a stated interface. Ask of each: what does
  it do, how is it used, what does it depend on?
- Where existing code in the path is a problem for this work, improve it as
  part of the design. Do not propose unrelated refactoring.
