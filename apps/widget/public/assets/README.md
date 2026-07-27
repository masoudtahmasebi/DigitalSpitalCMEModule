# Widget assets

Exported from Zeplin, 27.07.2026:
`assets_ADHSPlattformCMEFortbildungsbereichUebersichtV2 (1)_20260727.zip`

Each asset ships at 1x, `@2x` and `@3x`. Reference them through `srcset` so a
high-DPI display gets the right one rather than upscaling the 1x.

| Asset                                | Use                                           |
| ------------------------------------ | --------------------------------------------- |
| `logo-adhs`                          | ADHS mark                                     |
| `logo-gemeinsam-adhs-begegnen`       | "Gemeinsam ADHS begegnen" lockup, site header |
| `rechteck-2368*`                     | Course hero / card imagery                    |
| `schnittmenge-32`, `schnittmenge-33` | Decorative background shapes                  |
| `arrow*`, `arrow-down*`              | Inline and dropdown chevrons                  |
| `close-icon*`                        | Filter tag-chip dismiss                       |
| `pfad-2047`                          | Decorative path                               |

## Two notes

**These are raster exports of what are mostly vector shapes.** Arrows, chevrons
and close icons should be inline SVG in the widget: they scale cleanly, they
recolour via `currentColor` for focus and hover states, and they cost no extra
request. Using the PNGs for icons would also make the a11y focus indicators
(P5-10) harder to style. Keep the PNGs for the logos and photography.

**The widget renders inside a shadow root** (P5-01), and it is served from a
different origin than the MEDICE WordPress page. Asset URLs must therefore
resolve against the widget's own base, not the host page's — a bare relative
path will 404 against the WordPress origin.
