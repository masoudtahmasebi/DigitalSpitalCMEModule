## Ticket

<!-- e.g. P3-02. No ticket, no code (CLAUDE.md §2). -->

## What changed and why

<!-- The diff says what. Explain why, and any judgement call you made. -->

## Acceptance criteria

<!-- Copy from docs/backlog/<phase>.md and tick what this PR delivers. -->

- [ ]
- [ ]

## Deviations from the spec

<!-- State them here, or write "none". A deviation recorded is a decision;
     a deviation discovered later is a defect. -->

none

## Checks

- [ ] `pnpm verify` passes locally
- [ ] New compliance logic lives in `packages/domain` and is exhaustively tested
- [ ] Boundary rules respected (ADR-0006) — no controller touching a repository
- [ ] No secret in code, logs, or any API response
- [ ] No personal data (EFN, name, free-text evaluation) in any log
- [ ] `contracts/openapi.yaml` updated **first** if the API changed, SDK regenerated
- [ ] Docs touched by this change updated in the same PR

## Compliance review gate

Tick if this PR touches any of these — it then requires human review and must
not be self-merged:

- [ ] auth
- [ ] assessment
- [ ] eiv
- [ ] certificates
- [ ] tenant isolation / migrations

## How to verify

<!-- What a reviewer should run or click to see this working. -->
