# T01 · The widget appears on the page at all

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 25 min

## Preconditions

- A MEDICE WordPress page carrying the block **DS Education — Fortbildung** or the shortcode `[ds_lms]`
- Devtools open

## Cases

### T01.1 · The element is in the served HTML

**Steps**

1. Open the page.
2. **View source** (not the inspector — the served HTML).
3. Search it for `<ds-lms`.

**Expected**

- `<ds-lms` is present in the source.

> This is the first thing to check on any page, and it is not pedantry. MEDICE's `page.php` renders ACF components and never calls `the_content()`, so a shortcode typed into the editor is never printed: no markup, no log, nothing in the console — indistinguishable from a plugin that does not work. It cost an afternoon once. If `<ds-lms` is absent, stop: the shortcode is not being rendered by the theme and nothing further in this pack can run.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.2 · The bundle loads from the platform

**Steps**

1. In the Network tab, find `ds-lms.js`.
2. Note the host it came from, the status and the `Cache-Control` header.

**Expected**

- It comes from `widget.<basis-domain>`, **not** from the plugin folder.
- Status 200.
- No `?ver=` on the URL — freshness is the cache header's job.

> A 404 here means the element never upgrades and the page shows an empty area. WordPress reports nothing.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.3 · The custom element upgraded

**Steps**

1. In the console, run `customElements.get('ds-lms')`.

**Expected**

- It returns a constructor, not `undefined`.
- The area is filled with the widget, not blank.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.4 · The list is the default

**Steps**

1. On a page using bare `[ds_lms]` or the block with no course chosen.

**Expected**

- The **Fortbildungsbereich** renders — teal hero, CME seal, Thema and Altersgruppe filters, a card per Fortbildung.
- Not a single course, and not an error.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.5 · A single course can be named

**Steps**

1. On a page using `[ds_lms course="adhs-akademie-adult"]`.

**Expected**

- That course opens directly.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.6 · An unknown course slug

**Steps**

1. Set the shortcode to a slug that does not exist.

**Expected**

- The widget says so. It does not render blank and does not show another course.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The exact host and status of the `ds-lms.js` request.
- View-source output around `<ds-lms` if T01.1 failed.
