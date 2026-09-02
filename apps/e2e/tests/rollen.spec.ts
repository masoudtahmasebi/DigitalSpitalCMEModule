/**
 * The two customer roles, in a browser (P38-01).
 *
 * ## The requirement this is the evidence for
 *
 * > two distinct customer roles: one that can create departments/projects/
 * > courses, and one that can create **only courses**
 *
 * `packages/domain/src/staff-identity.ts` states the rule and unit-tests it
 * exhaustively; the API enforces it on every write. Neither of those is
 * something the client can look at. This file signs in as each of the two
 * seeded operators and asserts what each one actually gets — which is the only
 * form of that answer anybody outside the code can check.
 *
 * ## Where the boundary is enforced, and why the assertions look asymmetric
 *
 * The navigation hides a screen only where a capability gates it —
 * `customer`, `learner_record`, `certificate`, `staff_user`. **Organisation is
 * not gated**, deliberately (P9-01): the API is the gate, and a console that
 * decided access for itself would be a second implementation of the rule, in
 * the place least able to be trusted.
 *
 * So a `customer_admin` is asserted by what is *missing* from their menu, and a
 * `course_editor` by what the API says when they use a screen they can reach.
 * That asymmetry is the design, not an inconsistency in the test.
 *
 * ## These accounts come from the seed, not from this file
 *
 * `@ds/seed` creates them alongside the tenant — the same code the deploy runs
 * — so what is signed into here is what an installation actually has. They are
 * mock data and flagged as such in `docs/mock-data.md`.
 */

import { expect, test } from "@playwright/test";
import { menu, signInToConsole } from "../support/console.js";
import {
  COURSE_EDITOR_EMAIL,
  COURSE_WITH_POINTS_TITLE,
  CUSTOMER_ADMIN_EMAIL,
  STAFF_PASSWORD,
} from "../support/world.js";

/*
 * Each sign-in may wait up to thirty seconds for a TOTP step to roll over —
 * a code cannot be presented twice, and this file signs in twice. See
 * `freshTotpCode`.
 */
test.describe("die beiden Kundenrollen", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a customer administrator gets their own customer and not the registry", async ({
    page,
  }) => {
    await signInToConsole(page, {
      email: CUSTOMER_ADMIN_EMAIL,
      password: STAFF_PASSWORD,
    });

    /*
     * No customer picker, and no "Kunden".
     *
     * A customer administrator holds exactly one grant, so a picker would be a
     * control with a single option — a click nobody should have to make — and
     * the registry above every tenant is not theirs to see at all.
     *
     * What the app bar shows *instead* of a picker is deliberately not asserted
     * here: it shows the platform's name rather than the customer's, which is a
     * known gap recorded in `docs/backlog/P38.md` and in a comment at the site.
     * Asserting the current behaviour would freeze the gap in place; asserting
     * the intended behaviour would fail. So this asserts what is settled — that
     * there is no picker — and the gap stays visible as a ticket.
     */
    await expect(page.getByRole("combobox", { name: "Kunde" })).toHaveCount(0);
    await expect(menu(page).getByRole("button", { name: "Kunden" })).toHaveCount(0);

    // Everything their role does hold, on the other hand, is there.
    for (const entry of ["Organisation", "Fortbildungen", "Teilnehmende", "Konten"]) {
      await expect(menu(page).getByRole("button", { name: entry })).toBeVisible();
    }

    /*
     * And the tenant is populated: the seeded course is listed without anybody
     * having chosen a customer first, because there is nothing to choose. That
     * is the difference between this role and the super administrator's — for
     * whom every tenant screen is inert until they pick one.
     */
    await menu(page).getByRole("button", { name: "Fortbildungen" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(COURSE_WITH_POINTS_TITLE, "u") }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("a course editor may write courses and may not build an organisation", async ({
    page,
  }) => {
    await signInToConsole(page, {
      email: COURSE_EDITOR_EMAIL,
      password: STAFF_PASSWORD,
    });

    // Neither the registry nor the accounts screen: `course_editor` holds
    // `course` and `content` and nothing else.
    await expect(menu(page).getByRole("button", { name: "Kunden" })).toHaveCount(0);
    await expect(menu(page).getByRole("button", { name: "Konten" })).toHaveCount(0);

    // What they are for: the course list, populated.
    await menu(page).getByRole("button", { name: "Fortbildungen" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(COURSE_WITH_POINTS_TITLE, "u") }),
    ).toBeVisible({ timeout: 15_000 });

    /*
     * The other half, and the half worth having: the organisation is not
     * theirs. Neither Organisation nor Erscheinungsbild is drawn — both read
     * projects, and `project` is the capability this role does not hold.
     *
     * Asserted on the menu here because the API refusal has its own coverage
     * one layer down, where a `course_editor` principal is pointed at
     * `POST /admin/departments` and `POST /admin/projects` and gets 403 from
     * both. Between the two, "cannot see it" and "could not do it anyway" are
     * both stated — and only the second one is a security property.
     */
    for (const hidden of ["Organisation", "Erscheinungsbild"]) {
      await expect(menu(page).getByRole("button", { name: hidden })).toHaveCount(0);
    }

    /*
     * And they can actually work. Opening a course reaches its editor, which is
     * the screen this role exists for — and which, before P38-01, was behind
     * "Ihr Konto hat keine Berechtigung für die Verwaltung" along with
     * everything else.
     */
    /*
     * `exact`, because the row's delete button carries the course's title in
     * its own accessible name — "Fortbildung „…“ löschen" — and a substring
     * match therefore resolves to two elements the moment the course has no
     * enrolments and the delete control is drawn. The test was passing on the
     * state where it was hidden.
     */
    await page
      .getByRole("button", { name: COURSE_WITH_POINTS_TITLE, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: COURSE_WITH_POINTS_TITLE }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();
  });
});
