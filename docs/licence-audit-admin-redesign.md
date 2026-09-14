# Licence audit — the admin console redesign (P223, P224, P225)

The work order for the redesign named **TailAdmin**, **Cruip Mosaic** and
**JustBoil Admin One** as references, and required that no code or asset be used
before its licence and attribution obligations were recorded.

This is that record. It covers the three pull requests P223, P224 and P225.

---

## 1. The finding

**Nothing was copied.** No source code, assets, fonts, icons, illustrations,
screenshots or branding from any of the three references is present in these
changes. The references were used only as prior art for layout and interaction
principles — the ideas that a per-row control should be quiet, that a tree needs
a type scale, that a form field has a readable measure — each implemented
independently against this repository's own Tailwind preset and existing
primitives.

Because nothing was copied, **no attribution obligation arises**, whatever the
three licences say.

## 2. The evidence, and it is a negative that can be checked

| Question                                                   | Command                                                                                                                       | Result                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Any textual trace of the references in the repository?     | `grep -rniE "tailadmin\|mosaic\|cruip\|justboil\|admin-?one\|artifact-ui" --exclude-dir=node_modules --exclude-dir=.git .`    | **Nothing** outside the four backlog tickets that name them as inspiration                             |
| Any font, icon, image, SVG or media file added or changed? | `git diff --name-only origin/main...HEAD \| grep -iE '\.(woff2?\|ttf\|otf\|eot\|png\|jpe?g\|gif\|webp\|svg\|ico\|mp4\|pdf)$'` | **None**                                                                                               |
| What files do the three PRs add at all?                    | `git diff --name-status origin/main...HEAD \| awk '$1=="A"'`                                                                  | 13 files: 7 `.ts`/`.tsx`, 2 `.mjs`, 3 `.md`, 1 `.spec.ts`                                              |
| Any dependency added, removed or upgraded?                 | `git diff --name-only origin/main...HEAD \| grep -i lock`                                                                     | **`pnpm-lock.yaml` is unchanged**                                                                      |
| Any `package.json` change beyond scripts?                  | `git diff origin/main...HEAD -- '**/package.json' package.json`                                                               | Two new `check:` scripts and their entries in `verify`. No `dependencies` or `devDependencies` change. |

**Bundle-size impact: none from dependencies**, because there are none. The
changed CSS is Tailwind utility classes already in the project's own preset, so
no new utility family enters the build; the added TypeScript is three small
components extracted from a file that already shipped.

## 3. The references, their licences, and the commits they were read at

This section replaced an earlier one that said the licence texts **could not be
read**, because the GitHub API is not reachable from this environment. That was
true of the API and false of the repositories: `raw.githubusercontent.com` and
the git transport both work, and `git ls-remote` resolves an exact commit
without any API call. §11.14 — a stale note repeated is a stale note asserted —
so it is corrected here rather than left standing.

| Reference                     | Repository                                                        | Commit read (`git ls-remote … HEAD`)       | Licence                                              | Source of that finding                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **TailAdmin**                 | `TailAdmin/tailadmin-free-tailwind-dashboard-template`            | `e805ab8da73ff754f5420fa7c81b2528935b930d` | **MIT** — _"Copyright (c) 2023 TailAdmin"_           | `LICENSE` at that ref                                                                                                      |
| **TailAdmin** (React variant) | `TailAdmin/free-react-tailwind-admin-dashboard`                   | `046b73be65c7ec41b2d961d4aaa445236de49aad` | **MIT** — _"Copyright (c) 2023 TailAdmin"_           | `LICENSE.md` at that ref                                                                                                   |
| **Cruip Mosaic**              | `cruip/tailwind-dashboard-template` (package name `mosaic-react`) | `173f64183e3f5488e8e22d3a3f6a8de75bf63d7a` | **GPL** — see below                                  | `README.md` §"Terms and License"; **there is no `LICENSE` file in the tree** and `package.json` has **no `license` field** |
| **JustBoil Admin One**        | `justboil/admin-one-react-tailwind`                               | `251841fff0a36e4ac1eb96836adcd2858a66c3ac` | **MIT** — _"Copyright (c) 2019-current JustBoil.me"_ | `LICENSE` at that ref                                                                                                      |

### The work order's TailAdmin URL does not resolve

It names
`https://github.com/TailAdmin/free-tailwind-admin-dashboard-template/tree/main/tailwind-admin-nextjs-free`.
`git ls-remote` on that repository fails — GitHub answers as it does for a
repository that is not publicly readable. The two TailAdmin repositories in the
table above are the ones that do resolve, and both are MIT. Recorded because a
future reader following the work order's link will not find it.

### Cruip Mosaic is the one that matters, and it is **GPL**

Verbatim from `README.md` at `173f6418`:

> ## Terms and License
>
> - Released under the [GPL](https://www.gnu.org/licenses/gpl-3.0.html).
> - Copyright 2020 [Cruip](https://cruip.com/).
> - Use it for personal and commercial projects, but please don't republish,
>   redistribute, or resell the template.

Two things follow, and both are worth stating plainly:

1. **Copying Mosaic source into this repository would be a serious licence
   problem**, not a paperwork one. The GPL is copyleft; this platform is not
   distributed under it. That is precisely why the "inspiration only" rule in
   the work order exists, and why §1's negative finding is load-bearing rather
   than a formality.
2. **The licence is a README sentence, not a `LICENSE` file or an SPDX field.**
   There is nothing machine-readable to key on. Anyone who later reaches for
   Mosaic will find no licence file, and may conclude there is no licence.

### What each licence would require _if_ anything were used

- **MIT** (TailAdmin, Admin One): retain the copyright notice and the permission
  notice in any copy or substantial portion. In practice that means a
  `THIRD-PARTY-NOTICES` entry naming the project, the copyright line and the
  full MIT text.
- **GPL** (Mosaic): reciprocal. Distributing a work derived from it obliges
  distributing the corresponding source under the same terms. There is no
  attribution-only path.

**None of this is triggered.** §1 and §2 establish that nothing was copied, and
the obligation each licence creates is conditional on use.

### Fonts, icons, illustrations, screenshots, demo assets

**None taken from any reference.** The evidence is the file-type row in §2: the
three pull requests add no `woff`/`woff2`/`ttf`/`otf`/`eot`, no
`png`/`jpe?g`/`gif`/`webp`/`svg`/`ico`, no `mp4` and no `pdf`. Every added file
is `.ts`, `.tsx`, `.mjs` or `.md`.

Icons in the console are inline SVG paths written in this repository — the
`Chevron` and `Rosette` in the widget's `primitives.tsx` are the pattern, and
the admin console's are the same shape. Typography is the project's own
`--ds-font-family`, which is a **family name and never a URL**: the platform
loads no third-party font, for the reason recorded in
`packages/domain/branding.ts`.

### Dependencies

**No dependency was added, removed or upgraded.** `pnpm-lock.yaml` is unchanged
across all three pull requests (§2). So no transitive licence enters the build
and there is no new licence surface to audit.

## 4. The statement that appears on each pull request

> No source code, assets, fonts, icons, illustrations, screenshots or branding
> were copied from TailAdmin, Cruip/Mosaic/Artifact, or Admin One. The
> references were used only for independent implementation of layout and
> interaction principles.
