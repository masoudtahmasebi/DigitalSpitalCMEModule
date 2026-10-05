# Vendored Claude Code skills (P244-01)

Five skills in this directory are third-party content, copied verbatim from
[`amirtaherkhani/nestjs-skills`](https://github.com/amirtaherkhani/nestjs-skills)
at commit `6eaf52c0584b6e951ba0ee2e32a275932a8918c5`, under the MIT licence in
`NESTJS-SKILLS-LICENSE`.

| Skill                                      | What it is for                                  |
| ------------------------------------------ | ----------------------------------------------- |
| `nestjs-code-audit`                        | read-only, evidence-backed audit of `apps/api`  |
| `nestjs-architecture-principles`           | module boundaries, DI, coupling                 |
| `nestjs-oop-design-patterns`               | object design and pattern choice                |
| `nestjs-features-performance`              | guards, filters, errors, security, runtime, ops |
| `nestjs-professional-software-engineering` | implementation and verification idioms          |

## The one local change, and why

Each `SKILL.md` gains `disable-model-invocation: true`. Upstream, they load
themselves whenever a task looks NestJS-shaped, which in this repository is most
API work. They are general advice: they mention Kubernetes, TypeORM and Prisma,
and they treat an app-level `WHERE` filter on tenant as a normal control. Here
the deploy is Docker Compose on Hetzner, the ORM is Drizzle, and tenant
isolation is RLS (ADR-0002). General advice loaded silently into auth, assessment,
eiv or certificate work would compete with CLAUDE.md. Explicit invocation means a
person chose to ask for it: type `/nestjs-code-audit`.

**CLAUDE.md wins every conflict.** A finding from these skills is input to
review, not a rule of this repository.

## What was not taken

- `nestjs-git-commit-pr-message`: it competes with CLAUDE.md §2/§10 (P-number
  commits, attribution) and performs remote pushes and PR actions.
- `nestjs-feature-audit`: it runs `git fetch` and `git switch` in the working
  checkout.
- `evals/` and `agents/openai.yaml`: Codex and test-harness metadata, unused here.

The sibling skills still name the two excluded ones as optional coordination
partners "when installed". They are not installed, so those lines do nothing.

## What was checked before vendoring

The only executable is
`.claude/skills/nestjs-code-audit/scripts/collect-quality-evidence.mjs`.
It reads `.ts` files under a scope it confines to the repository root, and it
spawns only `git` (branch, rev-parse, status) and, with `--run`, the local
`node_modules/.bin/eslint --no-fix` and `tsc --noEmit`. It makes no network
calls and writes no files. The markdown was searched for fetch/install/push and
instruction-override patterns; the hits are documentation links and the excluded
git skill.

Upgrading means repeating that review against the new commit; do not pull blindly.

---

# Adapted from Superpowers (P245-01)

`brainstorming/` and `writing-plans/` are adapted from
[`obra/superpowers`](https://github.com/obra/superpowers) at commit
`8ca22dba9a94f28898bbce59f2537ff4d87c747d`, MIT licence in
`SUPERPOWERS-LICENSE`. Unlike the NestJS skills these are **edited**, so they
are formatted and checked like our own files, and an upgrade means re-reading
upstream and re-applying the intent rather than copying over.

## What changed, and why

| Upstream                                                                                       | Here                                                                                                                                            | Why                                                                                     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Loads itself: "You MUST use this before any creative work"; a hook makes every skill mandatory | Loads itself only for a request to build or change behaviour with no approved ticket (P246-01); `writing-plans` only after a ticket is approved | Upstream fires on almost anything; here the trigger is narrow and the content is ours   |
| Design → `docs/superpowers/specs/`, plan → `docs/superpowers/plans/`                           | Both go into the ticket, `docs/backlog/P<N>.md`                                                                                                 | The backlog is the one home of a work order (§2); two homes is §9.10b                   |
| Bounded changes get no document                                                                | A short ticket after approval                                                                                                                   | §2: no ticket, no code                                                                  |
| No project checks                                                                              | A table of CLAUDE.md checks that can stop the design                                                                                            | §3 deferred list and §7 "do not guess on compliance semantics" have to bite before code |
| Commit examples `feat: …`                                                                      | `P<N>-NN: …`                                                                                                                                    | §2 / §10 commit format                                                                  |
| Steps: failing test, pass, commit                                                              | Adds "break it on purpose" before the commit                                                                                                    | §9.1, §11.6                                                                             |
| Hands off to `subagent-driven-development` / `executing-plans` as REQUIRED sub-skills          | Implement in this session; `verify-loop.sh` for the four review-gate areas                                                                      | Those skills are not taken; §11 already defines the independent pass                    |
| Visual companion: a 723-line local web server                                                  | Removed                                                                                                                                         | Not audited; not needed for a text design                                               |
| Hour estimates in the task shape (via our own old format)                                      | None                                                                                                                                            | The budget was withdrawn (§3)                                                           |

## What was not taken

The plugin itself, and above all its `SessionStart` hook. On every start,
`/clear` and compaction it injects the `using-superpowers` skill inside
`<EXTREMELY_IMPORTANT>`, which says "If you think there is even a 1% chance a
skill might apply … you ABSOLUTELY MUST invoke the skill" and puts skill
invocation "BEFORE any response or action". That is a standing instruction set
above CLAUDE.md. The other twelve skills overlap rules CLAUDE.md already states
(TDD, verification before completion, code review) or assume the hook.
