# EIV-FOBI mock — documented assumptions

**This mock is built from documentation, not from observation.** Nobody on this
project has yet seen the real EIV-FOBI interface respond. Everything below is an
assumption, and it is written out field by field so that the first run against
the real sandbox or live endpoint produces a **diff** rather than an
investigation (ADR-0005).

## The real endpoint

The Anerkennungsbescheid (ÄKWL, 18.06.2026) names it:

> Mit der Anerkennung verpflichtet sich der Veranstaltende, die
> Fortbildungspunkte der Teilnehmenden … unter **https://punktemeldung.eiv-fobi.de/**
> direkt an den Elektronischen Informationsverteiler (EIV) der Bundesärztekammer
> zu melden.

So the **host** is settled. The **paths beneath it** (A1, B1) are still
unverified — the Bescheid names the service, not its API surface.

This is deliberately **not** the default `EIV_BASE_URL`. The harness refuses any
non-local host without `EIV_ALLOW_LIVE=yes`, because the configured VNR belongs
to a real accredited event and a submission there creates a genuine
Punktemeldung for a real physician.

When reality is observed, correct this mock immediately. A mock that disagrees
with the real interface is worse than no mock, because the test suite then
actively asserts the wrong behaviour.

## Assumed contract

### `POST /auth/login`

**Request**

```json
{ "vnr": "<19 digits>", "passwort": "<password>" }
```

**Assumptions**

| #   | Assumption                                                         | Confidence                                                                                   |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A1  | The auth endpoint is at `/auth/login`                              | **Low** — the documented flow says "authenticate using VNR + password" without naming a path |
| A2  | The credential field is `passwort` (German) rather than `password` | **Low**                                                                                      |
| A3  | Success returns `{ "token": "...", "expiresIn": 3600 }`            | **Low** — that the result is a JWT is documented; the envelope is not                        |
| A4  | Bad credentials return `401` with a JSON `message`                 | Medium                                                                                       |

### `POST /fobi/veranstalter/push_teilnahme`

**Request**

```json
{ "vnr": "<19 digits>", "efn": "<15 digits>", "rolle": "TEILNEHMER" }
```

**Assumptions**

| #   | Assumption                                                                                   | Confidence                                                                                                 |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B1  | The path and the three body fields are exactly as documented                                 | **High** — given explicitly                                                                                |
| B2  | The JWT is presented as `Authorization: Bearer <token>`                                      | Medium                                                                                                     |
| B3  | Success returns `{ "referenz": "...", "status": "ANGENOMMEN" }`                              | **Low** — that a reference is returned at all is an assumption, and P7-05 persists it for later correction |
| B4  | An unknown or malformed EFN returns `422` and must **not** be retried                        | Medium                                                                                                     |
| B5  | A repeat submission for the same VNR + EFN is acknowledged idempotently rather than rejected | **Low** — this matters: if EIV instead errors, the retry queue needs to treat that error as success        |
| B6  | Transport failures and `5xx` are retryable; `401`/`403` and `422` are not                    | Medium                                                                                                     |

### Not modelled at all

- **Corrections.** The 7-day correction window is confirmed by the Bescheid
  ("Nach erstmaliger Meldung an den EIV besteht eine 7-Tage-Frist für etwaige
  Korrekturen und Ergänzungen"), but the **mechanism** — a different endpoint, a
  flag, a re-POST — is unknown. `packages/domain` computes the window; nothing
  yet performs a correction.
- Rate limits, pagination, bulk submission, event metadata beyond the VNR.

### The open question the mock cannot answer

**What is `Veranstaltungsende` for an on-demand course?** The reporting clock
runs 8 days from it, and the Bescheid says the Fortbildungsmaßnahme is _am
13.10.2025_, valid _13.10.2025 – 12.10.2026_. Three readings, with wildly
different consequences:

- the **participant's completion date** — the only one that works operationally;
- **13.10.2025** — every submission is then already years late;
- **12.10.2026** — nothing may be reported until the validity window ends.

`eivDeadlines(eventEndAt, …)` takes this as an argument, so the code is
indifferent. We still do not know what to pass. `CLAUDE.md` §7: do not guess on
compliance semantics — this is a question for the Ärztekammer.

## Forcing failures

Send `x-mock-behaviour` to exercise a path:

| Value                | Effect                                                        |
| -------------------- | ------------------------------------------------------------- |
| `success` (default)  | Normal flow                                                   |
| `auth_failure`       | `401` from `/auth/login`                                      |
| `validation_failure` | `422` from `push_teilnahme`                                   |
| `duplicate`          | Idempotent acknowledgement                                    |
| `server_error`       | `503` — retryable                                             |
| `timeout`            | Never responds; the client's timeout ends it                  |
| `non_json`           | HTML body on a `200`, to prove the client reports it verbatim |

## Running

```bash
pnpm --filter @ds/eiv-harness start:mock     # listens on :4010
```
