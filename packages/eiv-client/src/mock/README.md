# EIV-FOBI mock — built from the published specification

**As of P31-01 this mock is built from the real contract**, not from guesses.
The Veranstalter Swagger (`EIV FOBI - Veranstalter`, OAS 3, version
`1.0 20260714-01`) arrived on 09.08.2026 and closed S24. Everything the previous
version of this file listed as an assumption was wrong; the table at the bottom
records that, because "we guessed and the guess was wrong" is worth keeping.

Where the specification is silent, this file still says so — those are the rows
that could still bite.

## Environments

| Purpose          | Host                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| API, test system | `https://backend-test.eiv-fobi.de` — the only server the Swagger names   |
| API, live system | `https://backend.eiv-fobi.de` — not in the Swagger; see below            |
| Web app, test    | `https://punktemeldung-test.eiv-fobi.de/`                                |
| Web app, live    | `https://punktemeldung.eiv-fobi.de/` — named by the Anerkennungsbescheid |
| API, live        | **not published** — see S26                                              |

The specification is explicit that test and production are completely separate
and that development must use the test system: _"Bitte nutzen Sie für die
Entwicklung ausschließlich das Test-System."_ Credentials and test events come
from EIV support, not from the live VNR.

None of these is the harness's default host. The harness refuses any non-local
host without an explicit `EIV_HARNESS_ALLOW_LIVE`, because the configured VNR
belongs to a real accredited event and a submission there creates a genuine
Punktemeldung for a real physician. The platform itself no longer takes either
value from the environment at all — since P180-01 the register and the consent
are rows in `platform_settings`, set in the console.

## The contract, as published

### `GET /fobi/veranstalter-auth/jwt`

HTTP **Basic**, username = VNR, password = VNRPWD. Returns `{ "jwt": "..." }`.

- `401` — VNR/password wrong, or the token was invalidated.
- `429` — too many requests. **Retry with backoff**, do not treat as permanent.
- `500` — retryable after a wait.

Changing the VNRPWD invalidates every token already issued, so a `401` on a
later call means "fetch a new token", not necessarily "the credentials are
wrong".

### `POST /fobi/veranstalter/push_teilnahme`

Bearer JWT. **The VNR is carried by the token and is not in the body.**

```json
{
  "efn": "<15 digits>",
  "punkte_basis_flag": true,
  "punkte_lernerfolg_flag": false,
  "punkte_referent": 0,
  "teilnahmedatum": "2023-07-30"
}
```

| Status | Meaning                                                                       | Retryable     |
| ------ | ----------------------------------------------------------------------------- | ------------- |
| `200`  | Processed. The stored state now equals what was sent.                         | —             |
| `401`  | Token missing, expired, or invalidated by a VNRPWD change                     | after re-auth |
| `406`  | Business refusal — unknown or blocked VNR, or a date outside the event period | **no**        |
| `422`  | Format error — failed EFN check digit, point value out of range               | **no**        |
| `500`  | Internal error. Retry **with an unchanged payload**.                          | **yes**       |

Three properties stated in prose, all of which this platform relies on:

1. **Idempotency is per `(EFN, VNR)`.** A repeat updates the same record; there
   is no double booking, and a repeat after an unclear `5xx` is explicitly safe.
2. **A withdrawal is a normal push** with `punkte_basis_flag: false`,
   `punkte_lernerfolg_flag: false`, `punkte_referent: 0`. The record is not
   deleted — _"der Vorgang bleibt nachvollziehbar"_.
3. **`affectedRows` and `messages` are diagnostic, not contractual.** _"Maßgeblich
   für die technische Bewertung einer Antwort ist immer der HTTP-Statuscode."_
   The mock returns them anyway, precisely so that a client which started
   reading them would still pass here and fail in production.

### `GET /fobi/veranstalter/veranstaltung`

Returns `vnr`, `thema`, `unterthema`, `beginn`, `ende`, `kategorie`,
`punkte_basis`, `punkte_lernerfolg`, `gesperrt_fuer_veranstalter`.

This is the endpoint that turns two open questions into a command:

- `beginn`/`ende` are what a `teilnahmedatum` is checked against, and therefore
  what **S11** — "what is `Veranstaltungsende` for an on-demand course?" — has
  been asking the Ärztekammer about in writing.
- `punkte_basis`/`punkte_lernerfolg` say which credit the event actually
  carries, which is **S25**.

```bash
pnpm --filter @ds/eiv-harness veranstaltung
```

### `GET /fobi/veranstalter/gemeldetepunkte?limit&offset`

An array of `{ efn, vnr, punkte_basis_flag, punkte_lernerfolg_flag,
punkte_referent, teilnahmedatum, created, last_modified }`, plus a
`service_db_clock_timestamp` response header.

This is reconciliation: our `eiv_submissions` table records what we _sent_, this
records what the Ärztekammer _holds_. A disagreement between the two is the one
failure an append-only log of our own attempts structurally cannot detect.

## What is still not known

| #       | Question                                                                                                                                                                                                                                                                                            | Owner       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| ~~S26~~ | ~~The production API base URL~~ — **`https://backend.eiv-fobi.de`, closed 20.08.** Not published anywhere: read off the live web app's own requests with DevTools open. Recorded with its provenance because an observation is weaker than a contract — if EIV move the host, nothing announces it. | —           |
| S25     | Which point flags a completion may claim for the accredited course. `veranstaltung` answers it against the test system.                                                                                                                                                                             | MEDICE/ÄKWL |
| S11     | Whether the accredited `ende` for an on-demand course permits completions throughout the validity window.                                                                                                                                                                                           | ÄKWL        |
| —       | Whether the interface **cross-checks** the flags against the event's point values. The mock deliberately does not (see S25).                                                                                                                                                                        | —           |

The 4xx bodies are documented as _"historisch gewachsen und aktuell nicht in
jedem Fall einheitlich"_, with a unification planned. The client therefore never
parses an error body for meaning — it records it verbatim and decides on the
status code.

## What we assumed before the specification, and what it actually was

Kept as a record, because five of six were wrong and the tests all passed:

| We assumed                              | It is                                             |
| --------------------------------------- | ------------------------------------------------- |
| `POST /auth/login` with a JSON body     | `GET /fobi/veranstalter-auth/jwt` with HTTP Basic |
| the token field is `token`              | `jwt`                                             |
| the push body carries `vnr` and `rolle` | neither                                           |
| `422` is the business rejection         | `406` is; `422` is a format error                 |
| success returns `{ referenz, status }`  | no reference, no status word                      |
| a repeat answers `BEREITS_GEMELDET`     | a repeat is indistinguishable from a first write  |

The lesson worth keeping: a mock written from the same guess as the client makes
CI assert the guess. Six of these were green for months.

## Forcing failures

Send `x-mock-behaviour` to exercise a path:

| Value                | Effect                                                        |
| -------------------- | ------------------------------------------------------------- |
| `success` (default)  | Normal flow                                                   |
| `auth_failure`       | `401` from the token endpoint                                 |
| `rate_limited`       | `429` — retryable, backoff                                    |
| `business_failure`   | `406` from `push_teilnahme`                                   |
| `validation_failure` | `422` from `push_teilnahme`                                   |
| `duplicate`          | Forces the update path without sending twice                  |
| `locked_event`       | `gesperrt_fuer_veranstalter: true`, and `406` on a push       |
| `server_error`       | `500` — retryable                                             |
| `timeout`            | Never responds; the client's timeout ends it                  |
| `non_json`           | HTML body on a `200`, to prove the client reports it verbatim |

A `teilnahmedatum` outside the configured period is refused `406` without any
header — that is the failure most likely to bite an on-demand Fortbildung, so it
is reachable the same way it would happen.

## Running

```bash
# Any date accepted:
pnpm --filter @ds/eiv-harness start:mock

# With an accredited period, so the 406 can be reproduced:
pnpm --filter @ds/eiv-harness start:mock -- --beginn 2026-01-01 --ende 2026-12-31
```
