/**
 * The catalogue hero gets its height once, not twice (P258-05).
 *
 * P255-01 made the mobile band `h-64` without a catalogue photograph and
 * `h-[27.5rem]` with one. `useBranding` starts as `{}` and fills in after a
 * fetch, so for any project *with* a photograph the band first painted at
 * 256 px and then jumped to 440 — 184 px of shift under a physician's thumb,
 * on a list of tappable cards. Before P255 the height never depended on
 * branding, so this is a regression P255 introduced.
 *
 * The catalogue now waits for branding (bounded — see `useBrandingStatus`),
 * and draws the band once, at the height it keeps.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";
import { de } from "./locale/de.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const PHOTO = "https://api.example.test/branding/catalog-hero?project=medice-adhs";

function stub(branding: Promise<Response>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    if (url.pathname === "/branding") return branding;
    return new Response(
      JSON.stringify({
        items: [],
        page: 1,
        perPage: 10,
        total: 0,
        facets: { thema: [], altersgruppe: [] },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });
}

function band(): Element | null {
  return document.querySelector("[class*='h-64'], [class*='h-[27.5rem]']");
}

function renderCatalogue(): void {
  render(
    <App
      apiBase="https://api.example.test"
      projectSlug="medice-adhs"
      courseSlug=""
      getToken={async () => "token"}
    />,
  );
}

describe("the catalogue hero", () => {
  it("is not drawn at a guessed height while branding is still on its way", async () => {
    let answer: (response: Response) => void = () => undefined;
    stub(new Promise<Response>((resolve) => (answer = resolve)));
    renderCatalogue();

    // Long enough for every other request to have answered.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(band(), "the band painted before its height was known").toBeNull();

    answer(
      new Response(JSON.stringify({ catalogHeroImageUrl: PHOTO }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await screen.findByRole("heading", { name: de.catalog.title });
    expect(band()?.className).toContain("h-[27.5rem]");
  });

  it("is drawn anyway when branding never answers — a hung fetch costs the photograph, not the page", async () => {
    stub(new Promise<Response>(() => undefined));
    renderCatalogue();
    await screen.findByRole("heading", { name: de.catalog.title }, { timeout: 3000 });
    expect(band()?.className).toContain("h-64");
  });

  it("is drawn compact at once when the project has no photograph", async () => {
    stub(
      Promise.resolve(
        new Response("{}", { headers: { "content-type": "application/json" } }),
      ),
    );
    renderCatalogue();
    await screen.findByRole("heading", { name: de.catalog.title });
    expect(band()?.className).toContain("h-64");
  });
});
