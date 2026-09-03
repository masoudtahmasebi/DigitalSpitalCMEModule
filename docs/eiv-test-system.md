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
record. The live-register consent exists to make that a decision rather than an
accident. Since P180-01 it is not a flag in a file: it is a row in
`platform_settings`, set in the console under **Plattform → Punktemeldung**, and
it records the name of the person who gave it and the moment they did. Changing
the register clears it — consent is to one register, not to the idea of
registers.

---

## How an admin runs it

### On the host, read-only — `./dsc eiv`

```bash
EIV_CHECK_ALLOW_LIVE=yes \
EIV_CHECK_BASE_URL=https://backend-test.eiv-fobi.de \
EIV_VNR=2760012024200354002 \
EIV_VNR_PASSWORD=<the password, from the course in the console> \
  ./dsc eiv
```

All four are arguments to **this one run** and belong in none of the
installation's files — `deploy.sh` refuses a `config.env` that carries any of
them. `dsc` forwards them into the container by name rather than by value, so
the password never appears in an argv; type it with a leading space if your
shell records history. They configure nothing: the register the platform
actually reports to is the console setting, and the VNR and its password belong
to the course.

It authenticates, prints the accredited period and the two Punktekennzeichen,
and lists what has already been reported. **It cannot file a Punktemeldung** —
`push_teilnahme` is absent from the entrypoint on purpose, because a filed report
cannot be unfiled, only withdrawn, and that leaves its own record.

Exit codes: `0` the register answered, `1` it refused or could not be reached,
`2` it was not asked because the configuration would not allow it.

The `EIV_CHECK_ALLOW_LIVE` argument is required for any non-local host, the
test system included. That is deliberate: even a read authenticates against the
VNR you pass, and on a production installation that VNR is a real accredited
event.

### The two lines to read

```
Zeitraum:  <beginn> → <ende>
Punkte:    basis=<n> lernerfolg=<n>
```

The first is **S11**: a `teilnahmedatum` outside that window is refused 406, and
the live VNR's window is a single day, which is why every completion this
platform reports would currently be rejected. The second is **S25**: which flags
a completion may claim.

### To file a test participation, use the product

Complete a course as a physician would. That is the path actually under test —
the widget, the gate, the evaluation, the EFN, the worker — and it is the only
one that proves the whole chain. Set a test VNR on the course, then open
**Plattform → Punktemeldung** as a super administrator and:

1. choose the register **EIV-Testsystem**;
2. switch **Punktemeldung aktiv** on.

No consent tick is needed for the test system — it reaches no real record, and a
safety switch you must clear to do ordinary work is a switch that is always
cleared. The worker reads this on every sweep, so it takes effect within a
minute; there is nothing to deploy and nothing to edit on the host.

Then read the banner on **Verwaltung → Teilnahme → Punktemeldungen**, which says
in words whether this installation will file anything (P121-01). Use a test EFN
from the list above.

> **The dangerous combination is the live endpoint with the live VNR and the
> worker on.** Each alone is harmless. Together they file a statutory report
> against a real physician. Two of the three are refused unless somebody
> deliberately arranges them in the console: the live register needs a consent
> with a name on it, and reporting has its own switch. Neither can now be set by
> editing a file on the host.

## What has been verified, and what has not

**Verified 31.08.2026, against the local mock, using these exact test values:**

|                                        |                                             |
| -------------------------------------- | ------------------------------------------- |
| `authenticate` with test VNR `…354002` | 200, JWT redacted in all output             |
| `veranstaltung`                        | period, Kategorie and both Punkte read back |
| `push_teilnahme` with test EFN `…0329` | 200, EFN masked to `***********0329`        |
| 406 → `business`                       | _"VNR unbekannt oder gesperrt"_             |
| 422 → `validation`                     | _"Ungültige EFN-Prüfziffer"_                |
| 429 → rate limited, 401 → auth         | both classified                             |
| duplicate                              | 200 with `messages: ["aktualisiert"]`       |
| the password                           | appears in no output, at any verbosity      |

So the client handles the real test identifiers correctly, and the failure-kind
mapping the Punktemeldung panel depends on is exercised end to end.

**Not verified: anything against the real EIV test server.** The development
sandbox's egress is an allowlist and `eiv-fobi.de` is not on it — every host
above answers `403` at the proxy, not at EIV. So the four questions only a real
response can settle are still open, and `./dsc eiv` from the host is what settles
them. That is the point of it existing.
