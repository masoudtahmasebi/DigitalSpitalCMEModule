# ADR-0010 — Extension points, and where they are forbidden

- **Status:** Accepted
- **Date:** 2026-07-28
- **Ticket:** P11-02
- **Deciders:** Masoud Tahmasebi

## Context

The platform is built for one customer and intended for several. Three things
about it will genuinely differ between them, and one thing must never differ.

What will differ:

1. **Which accreditation interface receives a Punktemeldung.** EIV-FOBI is the
   one MEDICE's Ärztekammer uses. Another Landesärztekammer may use something
   else; the Bescheid's own §2 already describes a paper fallback.
2. **How a Teilnahmebescheinigung is rendered.** The _content_ is prescribed by
   the Anerkennungsbescheid, but a customer's letterhead is not.
3. **How a certificate reaches the physician.** SMTP is the assumption; a
   customer with a patient portal may want it in an inbox instead.

What must never differ: **anything that decides whether a physician earned a CME
point.** Watched percentage, quiz scoring, gating, completion, the progress
rollup, the reporting deadline. Those are the platform's claims about a person's
education, made to a body that regulates the profession, and the platform has to
be able to say why it made every one of them.

There was already an implicit seam — `EivSubmitterPort`, a locally-declared
interface in the EIV module with one implementation. It worked, but it said
nothing about which _other_ things are extensible, and nothing at all about
which are not. A second developer adding "just a small hook" to the scoring path
would have found no rule to violate.

## Decision

**`packages/plugin-api` declares a fixed set of capability contracts. A
capability may carry out a decision; it may never make one.**

Four capabilities, and the list is closed until an ADR reopens it:

| Capability              | Receives                                               | Implementation today                                |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `accreditationReporter` | A completed participation the platform already decided | `EivAccreditationReporter` in `@ds/eiv-client`      |
| `certificateRenderer`   | Decided certificate data                               | Not registered — one renderer, injected directly    |
| `deliveryChannel`       | A composed message                                     | Not registered — P8-03 is unbuilt                   |
| `contentIngestor`       | Nothing; it pulls                                      | Not registered — Storyblok is deferred (roadmap §4) |

Three of the four are unregistered, deliberately. Declaring a contract is not
the same as building an implementation, and `find()` returning `undefined` is a
supported state: a deployment with no `deliveryChannel` sends no email, which is
exactly the documented behaviour for a project with no SMTP configuration.

**The following are explicitly not extension points**, and adding one is a
defect rather than a feature:

| Not extensible                         | Because                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Quiz scoring                           | Decides whether a physician earns a point                                                 |
| Watched percentage / the segment union | Same — and a max-position variant makes any gate trivially skippable                      |
| Chapter gating and completion          | Same                                                                                      |
| The progress rollup                    | One rollup path (CLAUDE.md §4 invariant 6); two would eventually disagree on a CME record |
| EIV deadline arithmetic                | A missed 8-day window cannot be reopened                                                  |
| Token validation, tenant resolution    | The whole of ADR-0002 and ADR-0003                                                        |
| Certificate _content_                  | The Anerkennungsbescheid prescribes the fields, the mandatory sentence and both barcodes  |

That table is in `capabilities.ts` as well as here, because the file is what a
developer reads at the moment they are tempted.

### One implementation per capability, not a chain

`register` replaces; it does not append. A chain of accreditation reporters
would file a physician's points twice, and a Punktemeldung cannot be withdrawn
once the seven-day correction window closes. A chain of certificate renderers
would produce two documents each claiming to be the same Teilnahmebescheinigung.

Registering twice for one capability throws rather than overwriting: two modules
each believing they own the reporter is a wiring mistake, and finding out at
boot beats finding out from a physician.

### Plugins are compile-time, not loaded at runtime

There is no `plugins/` directory scanned at boot, no manifest, and no dynamic
`import()` of a path from configuration. An implementation is a workspace
package that `apps/api/src/plugins.ts` imports and registers.

The usual argument for runtime loading — a customer extends the platform without
a deploy — runs the wrong way here. The process being extended holds a database
connection whose role deliberately cannot bypass row-level security, decrypts
VNR passwords with the application KMS key, and writes the append-only audit log
that is the evidence behind reported CME points. Code introduced without review
can read all three. A deploy is a small price for every extension having passed
the same review as the rest of the API.

### The registry is sealed after wiring

`installPlugins()` runs once, before the Nest application is created, and seals.
Nothing in the request path can swap the certificate renderer between two
requests — a mutable global that could is the kind of thing that works in every
test and fails once under load.

## Consequences

**Good.** The seam is real and has a real implementation on the far side of it:
`@ds/eiv-client` implements `AccreditationReporter` without importing anything
from `apps/api`, which is the property that makes a second Ärztekammer interface
a new file rather than a refactor. The forbidden list is now written down in a
place that is read.

**Cost.** One more package, and one more indirection between the submission
worker and the EIV client. `ParticipationReport.credentials` is a bag of strings
rather than named fields, because what a credential _is_ differs per authority —
which is honest but weaker typing than `vnrPassword: string` was. The reporter
names the key it reads (`EIV_PASSWORD_KEY`) and the caller uses that constant,
so the two cannot drift silently.

**Deliberate scope note.** A plugin architecture is not in `docs/roadmap.md` §4
and CLAUDE.md §3 makes the in-scope list exhaustive. This was built on an
explicit instruction to make the platform extensible, which under CLAUDE.md §2
means the work order wins and the deviation is recorded — here, and in the PR.
It is a small deviation by design: four interfaces and a map, no runtime loading,
and nothing in the compliance core touched.

## Alternatives considered

**Leave `EivSubmitterPort` as it was.** It already allowed a second reporter.
Rejected because a local interface documents one seam and says nothing about the
others — in particular nothing about which seams must not exist, which is the
half of this decision that carries the compliance risk.

**A general middleware or hook bus.** Rejected outright. A hook that can observe
a quiz submission is one refactor away from a hook that can change its result,
and the difference would be invisible in review.

**Runtime plugin loading from a directory.** Rejected for the reasons above. If
a customer ever genuinely needs it, the honest form is a separate process with
its own database role and its own network boundary, not a module in this one.

## References

- `packages/plugin-api/src/capabilities.ts` — the contracts and the forbidden list
- `packages/plugin-api/src/registry.ts` — one implementation per capability
- `apps/api/src/plugins.ts` — what this deployment installs, and what it does not
- ADR-0002 (tenant isolation), ADR-0003 (token validation), ADR-0005 (EIV
  contract-first), ADR-0007 (headless core and host adapters)
