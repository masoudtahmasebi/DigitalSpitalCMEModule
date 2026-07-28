# ADR-0009 — No third-party frontend assets; white-label fonts are uploaded and self-hosted

- **Status:** Accepted
- **Date:** 2026-07-28
- **Ticket:** P10-08
- **Deciders:** Masoud Tahmasebi

## Context

The platform is sold to more than one customer, so logo, colours, corner radius
and typeface have to be configurable per project rather than compiled into a
stylesheet. Typeface is the awkward one: a colour is a value, a font is a file
that a browser must fetch from somewhere.

The obvious design — a settings field for a font URL — puts that "somewhere"
outside our control, and in practice the URL people paste is a Google Fonts one.

That is a legal problem in this market, not a stylistic one. LG München I,
3 O 17493/20 (20.01.2022) awarded damages against a website operator for
embedding Google Fonts remotely, on the basis that transmitting a visitor's IP
address to Google without consent violated their right to informational
self-determination. The judgment produced a wave of German warning letters. The
learners here are physicians reading medical education on a pharmaceutical
company's site; it is precisely the wrong context in which to relitigate it.

"Self-host it on your own CDN" does not solve it either. It relocates the third
party and leaves us unable to state, in a processing record, what a visitor's
browser contacts.

The widget also runs inside a customer's WordPress page, so anything it loads is
loaded in the customer's name, under the customer's Datenschutzerklärung.

## Decision

**No frontend asset of this platform is fetched from a third-party origin.** No
font CDN, no analytics, no tag manager, no embedded video platform, no icon
service.

For typefaces specifically: a customer admin **uploads** a font file. It is
stored on the project row and served from the API's own origin by
`GET /branding/font`.

Three constraints on the upload, all of them because the file is served from our
origin to a page holding a bearer token:

1. **woff2 or woff only, decided by the file's own container signature.** The
   declared MIME type is a claim by the uploader and is only ever cross-checked
   against the sniffed result — it can permit nothing.
2. **The header's length field must equal the file's length.** This rejects the
   polyglot: valid woff2 to a font parser, something else to anything that keeps
   reading. We serve this with a year-long cache; it must be exactly as long as
   it claims to be.
3. **SVG fonts are unreachable by construction** — no branch returns one, the
   column has a CHECK, and the zod enum has no such member. An SVG font is
   executable markup.

Font bytes live in a `bytea` column rather than object storage: a subsetted
woff2 is tens of kilobytes, it is read on nearly every widget render, and an
outbound HTTP call on that path turns a CDN blip into unstyled text.

The `@font-face` rule is emitted into the **document**, not the shadow root —
Chrome ignores font faces declared inside a shadow root. Only the declaration
escapes the widget; every `font-family` reference stays inside it.

Every branding value is validated against a strict grammar in `packages/domain`
before storage and again on read.

## Rationale

Making the compliant path the only path is the whole point. A rule saying "do not
use Google Fonts" is a rule somebody breaks under deadline; an upload field with
no URL input cannot be pointed at Google at all.

Serving from our own origin also gives a clean, short answer to the questions a
DPO actually asks: what does a visitor's browser contact, and who receives their
IP address. The answer is "this platform, and nobody else" — which is a sentence
that fits in a processing record without qualification.

Validating on read as well as on write matters because a value written before a
grammar tightened must not be able to reach a stylesheet. Dropping an invalid
value rather than repairing it matters because a repaired value is one somebody
has to reason about later, and nobody will.

## Consequences

**Positive**

- Nothing to disclose about third-party recipients of frontend requests, and
  nothing for a consent banner to cover.
- A customer's brand manual can be honoured without a deployment.
- The platform is demonstrably sellable to a second customer, which the
  white-label requirement exists for.
- No availability dependency on a CDN for the site to render legibly.

**Negative**

- **We host font files somebody else licensed.** A customer uploading a font
  they may not redistribute is a licensing exposure that a URL field would have
  left with them. Mitigated only by copy on the upload screen asking for a
  web-embedding licence — this is a real residual risk and it is named here
  rather than hidden.
- **A 2 MB upload path exists**, which needed a body-size limit at three layers
  (Caddy, express, the column CHECK) and a rate limit. The first two were wrong
  initially and rejected legitimate uploads with an opaque 413.
- **Font bytes are in the database**, so they are in every `pg_dump`. A few
  hundred kilobytes per customer; acceptable, and stated so nobody is surprised
  by backup size.
- **No icon font, no CDN convenience.** Icons are inline SVG or nothing.

## Alternatives considered

**A font URL field.** One line of code, and it makes the unlawful configuration
the easy one. Rejected.

**Bundle a fixed set of licensed fonts.** Removes the licensing exposure and the
upload path entirely, but caps white-labelling at whatever we bought, which
defeats the requirement — a customer's brand manual names a typeface, not a
category.

**Object storage for the file, presigned per render.** Consistent with how course
media is handled, but puts an outbound request in front of every widget render
for a file measured in tens of kilobytes.

**Declare `@font-face` inside the shadow root.** Would keep everything scoped to
the widget. Chrome does not apply it, and the failure is silent — the fallback
stack renders and it looks like a broken upload.
