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

## 3. What this audit does **not** establish, and why

**The three references' licence texts were not read**, and this document does
not state them.

The environment this work ran in restricts GitHub access to
`masoudtahmasebi/DigitalSpitalCMEModule`. Reading the licence metadata for
`cruip/mosaic-lite`, `TailAdmin/tailadmin-free-tailwind-dashboard-template` and
`justboil/admin-one-react-tailwind` was attempted and refused:

```
GitHub access to this repository is not enabled for this session.
```

Stating a licence from memory would be precisely the kind of fluent, unverified
sentence CLAUDE.md §11 exists to stop — and it would be load-bearing, because
somebody would later rely on it. So: **not recorded, and recorded as not
recorded.**

This does not block approval of P223–P225, because the obligation those licences
create is conditional on use, and §1 and §2 above establish there was none. It
**would** block any future change that copies from them, and such a change must
record, before it is written:

- the exact repository URL;
- the exact commit or tag inspected;
- the SPDX identifier and the full licence text as of that commit;
- every attribution or notice requirement;
- a file-by-file list of what was copied versus reimplemented.

## 4. The statement that appears on each pull request

> No source code, assets, fonts, icons, illustrations, screenshots or branding
> were copied from TailAdmin, Cruip/Mosaic/Artifact, or Admin One. The
> references were used only for independent implementation of layout and
> interaction principles.
