# The desktop layout, at design resolution

Nine screens. These are the client's own PNG exports of the Adobe XD file, at
1920 px wide — the width the layout was drawn at.

## Why these exist when `../screens/` already does

`../screens/page-01.png` … `page-13.png` are pages lifted out of the delivered
PDF. They are the **complete set** and they are what the numbering in the
tickets refers to. But a PDF page is a rasterised composite: text edges are
soft, a 1 px rule and a 2 px rule are hard to tell apart, and a colour sampled
from one carries the PDF's own conversion.

These are exports of the same screens from the design tool. Where a ticket says
"measure it", measure it here. Where a ticket says "page 04", that still means
`../screens/page-04.png`.

Supplied at 3840 px — 2× — and stored at 1× because 2× cost 19 MB against a
24 MB repository, and 1× is the resolution the design is actually specified in.
Ask the client for the 2× export if a specific measurement is ever in doubt.

| File                                  | Desktop page       | Notes                       |
| ------------------------------------- | ------------------ | --------------------------- |
| `uebersicht.png`                      | page 01            | the catalogue               |
| `uebersicht-variante.png`             | page 01, alternate | see below                   |
| `detailseite-uebersicht.png`          | page 03            | Übersicht tab               |
| `detailseite-zertifizierung.png`      | page 04            | Zertifizierung tab          |
| `detailseite-experten-referenten.png` | page 05            | Referenten tab              |
| `detailseite-mediathek.png`           | page 02            | Mediathek tab               |
| `detailseite-mediathek-variante.png`  | page 02, alternate | see below                   |
| `player-zusammenfassung-v1.png`       | pages 06–08        | player, Zusammenfassung tab |
| `player-zusammenfassung-v2.png`       | pages 06–08        | the later of the two        |

## The pairs

Three screens arrived twice — `uebersicht`, `detailseite-mediathek` and the
player — with different content in each copy and no note saying which is
current. They are not duplicates: the files differ.

Both halves of each pair are kept, because discarding the one that turns out to
be authoritative is not recoverable from here, and `-variante` / `-v1` says
plainly that a choice has not been made rather than implying one has.

**Which is authoritative is a question for the client**, and it is in
`docs/show-stoppers.md` rather than decided here. Until it is answered, the
implementation follows the PDF (`../screens/`), which is the delivered
document.

## How these were captured

Supplied as a zip of PNG exports. Committed with the filenames shortened — they
lost the `ADHS-Plattform-CME-Fortbildungsbereich-` prefix and the `-V2` suffix —
so that a directory listing is readable, and downscaled 2:1 as described above.
Nothing else was changed.
