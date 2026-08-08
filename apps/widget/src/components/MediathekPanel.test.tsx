/**
 * The Mediathek, rendered (P5, layout page-05).
 *
 * ## What is worth asserting here
 *
 * Two things, and both are about the padlock rather than about the grid.
 *
 * The gate is the **absent `fileUrl`**, decided by the API. This component
 * could not reveal a locked file if it tried, and the tests below say so by
 * asserting there is no download link rather than by asserting a CSS class —
 * a blur is a visual cue, and a test that checked for the blur would be
 * testing the cue instead of the gate.
 *
 * The second is the accessibility of that cue. A blurred block read aloud is a
 * list of titles that render as an unreadable smear, so the block is
 * `aria-hidden` and the section carries the lock message as its name. That is
 * the kind of thing nobody notices is broken.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MaterialLibrary } from "@ds/sdk";
import { MediathekPanel } from "./MediathekPanel.js";

afterEach(cleanup);

type Group = MaterialLibrary["groups"][number];
type Material = Group["materials"][number];

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: "0198f4c1-7a2e-7000-8000-0000000000c1",
    title: "Patienteninformation Modul 1 (PDF)",
    description: "Begleitmaterial zum Modul, geeignet zur Weitergabe.",
    locked: false,
    fileUrl: "https://media.example.org/1.pdf",
    mimeType: "application/pdf",
    fileSize: 524288,
    ...overrides,
  };
}

/** A whole library, so `courseSlug` is supplied once rather than at five call sites. */
function library(...groups: Group[]): MaterialLibrary {
  return { courseSlug: "adhs-akademie-adult", groups };
}

function group(overrides: Partial<Group> = {}): Group {
  return {
    moduleId: "0198f4c1-7a2e-7000-8000-0000000000d1",
    moduleTitle: "Modul 1 – Grundlagen",
    ordinal: 0,
    locked: false,
    materials: [material()],
    ...overrides,
  };
}

describe("an unlocked card", () => {
  it("shows the authored description under the title", () => {
    // The paragraph the layout draws. This component used to say it did not
    // exist; `contents.body` had been a column since migration 0001 and simply
    // never reached the learner.
    render(<MediathekPanel library={library(group())} />);

    expect(screen.getByText(/Begleitmaterial zum Modul/)).toBeTruthy();
  });

  it("keeps the file meta as well as the description", () => {
    // "PDF · 512 KB" is what tells somebody on a train whether to tap Download
    // now. An authored paragraph does not replace it.
    render(<MediathekPanel library={library(group())} />);

    expect(screen.getByText(/512/)).toBeTruthy();
  });

  it("renders no empty paragraph when there is no description", () => {
    // Most existing content has no body, and a placeholder sentence would be
    // worse than a shorter card.
    render(
      <MediathekPanel
        library={library(group({ materials: [material({ description: null })] }))}
      />,
    );

    expect(screen.queryByText(/Begleitmaterial/)).toBeNull();
    expect(screen.getByRole("link", { name: /Download/ })).toBeTruthy();
  });
});

describe("a locked group", () => {
  it("offers no download link at all", () => {
    // The gate, asserted where it lives. A locked material arrives with
    // `fileUrl: null`, so there is nothing to un-blur with a devtools
    // inspector — which is why the blur is honest rather than theatre.
    render(
      <MediathekPanel
        library={library(
          group({ locked: true, materials: [material({ locked: true, fileUrl: null })] }),
        )}
      />,
    );

    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  });

  it("says what unlocks it", () => {
    render(
      <MediathekPanel
        library={library(
          group({ locked: true, materials: [material({ locked: true, fileUrl: null })] }),
        )}
      />,
    );

    expect(screen.getByText(/freigeschaltet/)).toBeTruthy();
  });

  it("hides the blurred block from a screen reader and names the section instead", () => {
    // A blurred block read aloud is a list of titles the screen does not
    // actually show. The section's accessible name carries the lock message
    // so the two agree.
    const { container } = render(
      <MediathekPanel
        library={library(
          group({ locked: true, materials: [material({ locked: true, fileUrl: null })] }),
        )}
      />,
    );

    expect(container.querySelector('[aria-hidden="true"].blur-sm')).toBeTruthy();
    expect(screen.getByLabelText(/Modul 1/)).toBeTruthy();
  });

  it("still draws the padlock when the API withholds the titles too", () => {
    // Otherwise the overlay floats over nothing and the group reads as empty
    // rather than as locked.
    const { container } = render(
      <MediathekPanel library={library(group({ locked: true, materials: [] }))} />,
    );

    expect(screen.getByText(/freigeschaltet/)).toBeTruthy();
    expect(container.querySelector(".blur-sm")).toBeTruthy();
  });
});

describe("the module filter", () => {
  it("lists every group and defaults to all of them", () => {
    render(
      <MediathekPanel
        library={library(
          group(),
          group({
            moduleId: "0198f4c1-7a2e-7000-8000-0000000000d2",
            moduleTitle: "Modul 2 – Diagnostik",
            ordinal: 1,
          }),
        )}
      />,
    );

    const select = screen.getByLabelText(/Modul/) as HTMLSelectElement;
    // Two modules plus the "all" option.
    expect(select.options).toHaveLength(3);
    expect(select.value).toBe("");
  });
});
