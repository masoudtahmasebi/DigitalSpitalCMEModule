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
