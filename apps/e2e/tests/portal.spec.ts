/**
 * The portal, in a real browser (P35-01).
 *
 * These assert what a physician can *see and do*, which is the one thing the
 * fifteen API suites structurally cannot: they drive HTTP, and everything
 * between a rendered pixel and a request is invisible to them.
 */

import { expect, test } from "@playwright/test";
import {
  forgetSignInAttempts,
  PARTICIPANT_EMAIL,
  PARTICIPANT_PASSWORD,
  TENANT,
} from "../support/world.js";

test.describe("the front door", () => {
  test("the bare domain is a welcome page, not somebody's tenant", async ({ page }) => {
    // P21-03: `/` serves every customer and none. Landing a physician on a
    // tenant they do not belong to would be a cross-customer disclosure in the
    // most visible place there is.
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Fortbildungen von DigitalSpital" }),
    ).toBeVisible();
    // It explains where to go rather than guessing.
    await expect(page.getByText("/medice")).toBeVisible();
  });

  test("an unknown tenant is refused, and does not leak whether it exists", async ({
    page,
  }) => {
    await page.goto("/keine-solche-firma");

    // Whatever it says, it must not be a sign-in form: offering credentials for
    // a tenant that may not exist is how an enumeration oracle gets built.
    await expect(page.getByLabel("Passwort")).toHaveCount(0);
  });

  test("a tenant in the path reaches its own sign-in", async ({ page }) => {
    await page.goto(`/${TENANT}`);

    await expect(page.getByLabel("E-Mail-Adresse")).toBeVisible();
    await expect(page.getByLabel("Passwort")).toBeVisible();
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  });
});

test.describe("signing in", () => {
  test.beforeEach(async () => {
    await forgetSignInAttempts();
  });

  test("refuses a wrong password without saying which half was wrong", async ({
    page,
  }) => {
    await page.goto(`/${TENANT}`);

    await page.getByLabel("E-Mail-Adresse").fill(PARTICIPANT_EMAIL);
    await page.getByLabel("Passwort").fill("definitiv-falsch");
    await page.getByRole("button", { name: "Anmelden" }).click();

    // One message for "no such account" and "wrong password" alike — the
    // locale's own comment says the API answers them identically on purpose.
    await expect(
      page.getByText("E-Mail-Adresse oder Passwort ist nicht korrekt."),
    ).toBeVisible();
  });

  test("lets a seeded participant in, and shows them the catalogue", async ({ page }) => {
    await page.goto(`/${TENANT}`);

    await page.getByLabel("E-Mail-Adresse").fill(PARTICIPANT_EMAIL);
    await page.getByLabel("Passwort").fill(PARTICIPANT_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();

    // The widget mounts inside a shadow root, so this is also the assertion
    // that the custom element registered and the API answered it — the seam
    // P29 found two defects in.
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible({
      timeout: 20_000,
    });
  });
});
