# The EIV test system

Arrived 31.08.2026 from EIV support, closing **S27**. Until then nothing in this
platform had ever spoken to a real EIV server.

## Where it is

|                          |                                                |
| ------------------------ | ---------------------------------------------- |
| Swagger                  | <https://veranstalter-swagger-ui.eiv-fobi.de/> |
| Punktemeldung app (test) | <https://punktemeldung-test.eiv-fobi.de/>      |
| API base                 | `https://backend-test.eiv-fobi.de`             |

Code examples per language were promised "in Kürze" and are not published yet.

## Test Veranstaltungen

```
2760012024200354002
2760012024200355009
2760012024200356007
```

## The password is not in this repository, and will not be

CLAUDE.md §4 invariant 7: VNR passwords are write-only — encrypted at rest under
the application KMS key, never plaintext, never logged, never returned by any
API. A **test** password committed to a file is the same habit as a live one, and
this project has already had the live VNR password shared over chat twice (S10,
still open, still wanting rotation before launch).

`apps/eiv-harness/src/cli.ts` enforces the same rule from the other side: it
reads `EIV_VNR_PASSWORD` from the environment and says, in its own error
message, that credentials "are never read from a file in this repository".

Put it in one of two places and nowhere else:

- the console — **Verwaltung → Angebot → Fortbildung → VNR-Passwort**, a
  write-only field; or
- `EIV_VNR_PASSWORD` in the host's `config.env`, for the harness.

## Test EFNs

Synthetic, issued by EIV for this purpose. They belong to no physician, which is
why they can be written down here at all — a real EFN may not appear in a log, an
audit `detail`, an error message or any other person's response (ADR-0004), and
this file would be none of those but the habit is the point.

```
802760020090329  802760020090337  802760020090345  802760020090352
802760020090360  802760020090378  802760020090386  802760020090394
802760020090402  802760020090410  802760020090428  802760020090436
802760020090444  802760020090451  802760020090469  802760020090477
802760020090485  802760020090493  802760020090501  802760020090519
802760020090527  802760020090535  802760020090543  802760020090550
802760020090568  802760020090576  802760020090584  802760020090592
802760020090600  802760020090618  802760020090626  802760020090634
802760020090642  802760020090659  802760020090667  802760020090675
802760020090683  802760020090691  802760020090709  802760020090717
802760020090725  802760020090733  802760020090741  802760020090758
```

44 of them. They are 15 digits and pass the platform's format check, so they are
also the right fixtures for **DEP-15 T10.3**, where the tester needs a number
that is accepted rather than merely well-formed.

## What this unblocks

**The four unknowns only a real response answers.** Whether Basic auth on a GET
behaves as documented behind their gateway; what the 4xx bodies actually look
like ("historisch gewachsen", by their own admission); whether `teilnahmedatum`
is validated as we expect; and whether our failure-kind mapping — 406 business,
422 validation — matches what the server really sends.

**A way at S11 that does not need the ÄKWL.** The live VNR
`2760552025919300018` holds a one-day accredited period, so every real
Punktemeldung would be refused 406, and the correction request is still with the
Kammer. These test VNRs have periods of their own: the platform's behaviour
against a one-day window versus a longer one can be established on the test
system now, and the fix verified the day the ÄKWL answers.

## The rule that has not changed

**Never point the worker at the live system to try something.** `push_teilnahme`
against a real VNR files a statutory Punktemeldung against a real physician's
EFN, and a filed report cannot be unfiled — only withdrawn, which leaves its own
record. `EIV_ALLOW_LIVE` exists to make that a decision rather than an accident,
and `EIV_WORKER_ENABLED=no` is currently set on production for the same reason.
