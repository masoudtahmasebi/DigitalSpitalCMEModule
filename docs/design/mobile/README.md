# The mobile layout

Seven screens, 860 px wide — 2× of 430, an iPhone Pro Max. Delivered
after the desktop pages in `../screens/`, and **authoritative for small
viewports the same way those are for large ones**.

| File                                  | Desktop counterpart     |
| ------------------------------------- | ----------------------- |
| `uebersicht.png`                      | page 01, the catalogue  |
| `detailseite-uebersicht.png`          | page 03, Übersicht tab  |
| `detailseite-experten-referenten.png` | page 05, Referenten tab |
| `detailseite-zertifizierung.png`      | page 04, Zertifizierung |
| `player-zusammenfassung.png`          | pages 06–08, the player |
| `player-ansicht-abgeschlossen.png`    | page 12, completion     |
| `progress-sticky-module.png`          | **no counterpart**      |

## The one that is not a responsive variant

`progress-sticky-module.png` is a **new component**, and the only screen here
that adds behaviour rather than rearranging it.

A teardrop button floats over the page, closed by default, showing a progress
ring. Pressing it opens a card — "Ihr Fortschritt", a donut reading _2 von 3_,
"Sie haben 2 von 3 Modulen abgeschlossen", and **Fortbildung fortsetzen**.

It exists because the desktop's sticky meta bar has nowhere to go on a 430 px
screen: the elapsed/total clock, the module count and the resume button do not
fit on one row, and stacking them costs a third of the viewport on a page whose
whole purpose is a video. So the information collapses to one tappable dot, and
`Fortbildung fortsetzen` — which P15-04 made a real destination — is the card's
primary action.

That makes it a **P15-04 surface**, not decoration: it is the resume affordance
on the device most learners will use.

## What differs from desktop, on first reading

Enough to record now; the itemised comparison belongs with the implementation
(P19), done the way `../README.md` did it for the catalogue — one row per
element, with a verdict.

- **Navigation** collapses to a hamburger. There is no desktop equivalent, so
  the menu's contents and its open state are both new.
- **The hero** is full-bleed with a curved bottom-right corner, and the CME seal
  sits over its **bottom-left**. On desktop the seal is centred on the content
  column's right edge. That is a different anchor, not a smaller one.
- **The filters** become a bordered card with the delivery-type label ("On
  Demand") as its heading, the two selects stacked full-width, and the tag chips
  wrapping to two rows.
- **Course cards** go one per row with the image above the text rather than
  beside it — `CourseList.tsx` already does this at `sm:`, so this one may be
  close already and needs measuring rather than rewriting.

## How these were captured

Supplied by the client as a zip of PNG exports, committed verbatim apart from
the filenames, which lost the `ADHS-Plattform-CME-Fortbildungsbereich-` prefix
and the `-Mobile` suffix so that a directory listing is readable.
