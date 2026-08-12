/**
 * The player.
 *
 * jsdom has no media pipeline — `play()` is not implemented, `duration` is
 * `NaN`, nothing ever decodes — so these are deliberately not tests that a
 * video plays. They assert the things that are wrong *without* a media
 * pipeline, and each is something a learner would experience:
 *
 * 1. **Every rendition is offered, in the order given.** The `<source>` list
 *    is the whole of the format negotiation; a lost or reordered entry costs
 *    Safari its adaptive stream, silently.
 * 2. **The coverage bar draws the server's union.** It is the only place a
 *    learner can see what the CME gate has credited, and drawing anything
 *    locally accumulated would show credit that was rejected.
 * 3. **Every control has an accessible name.** A physician using a screen
 *    reader who cannot operate the player cannot earn the points.
 * 4. **Failures say which failure.** "It did not play" is not actionable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MediaSource } from "@ds/sdk";
import { VideoPlayer } from "./VideoPlayer.js";

afterEach(cleanup);

const sources: MediaSource[] = [
  { url: "https://cdn/x.m3u8", mimeType: "application/vnd.apple.mpegurl", label: null },
  { url: "https://cdn/x-720.mp4", mimeType: "video/mp4", label: "720p" },
  { url: "https://cdn/x-360.mp4", mimeType: "video/mp4", label: "360p" },
];

function renderPlayer(over: Partial<React.ComponentProps<typeof VideoPlayer>> = {}) {
  const props = {
    sources,
    posterUrl: "https://cdn/x.jpg",
    captionsUrl: "https://cdn/x.vtt",
    title: "Modul 3 — Diagnostik",
    durationSec: 1545,
    startAtSec: 875,
    // Unrestricted by default: the seek-limit tests below opt in, so every
    // other test keeps asserting the player's ordinary behaviour.
    seekCeilingSec: null as number | null,
    watchedSegments: [],
    paused: false,
    onPlayback: vi.fn(),
    onTick: vi.fn(),
    onStop: vi.fn(),
    ...over,
  };
  return { ...render(<VideoPlayer {...props} />), props };
}

describe("sources", () => {
  it("offers every rendition, in the order it was given", () => {
    // The order is the negotiation: the browser takes the first `type` it can
    // play, so a reorder here costs Safari its adaptive stream with nothing
    // visibly wrong on Chrome.
    const { container } = renderPlayer();
    const rendered = [...container.querySelectorAll("source")].map((node) => [
      node.getAttribute("src"),
      node.getAttribute("type"),
    ]);

    expect(rendered).toEqual([
      ["https://cdn/x.m3u8", "application/vnd.apple.mpegurl"],
      ["https://cdn/x-720.mp4", "video/mp4"],
      ["https://cdn/x-360.mp4", "video/mp4"],
    ]);
  });

  it("sets no `src` on the element itself", () => {
    // A `src` attribute wins over every <source> child, so one left behind
    // would pin all browsers to a single rendition and make the list decorative.
    const { container } = renderPlayer();
    expect(container.querySelector("video")?.hasAttribute("src")).toBe(false);
  });

  it("carries the poster, so the play button does not sit on a black rectangle", () => {
    const { container } = renderPlayer();
    expect(container.querySelector("video")?.getAttribute("poster")).toBe(
      "https://cdn/x.jpg",
    );
  });

  it("says so plainly when there is nothing to play", () => {
    renderPlayer({ sources: [] });
    expect(
      screen.getByText("Für diesen Abschnitt ist kein Video hinterlegt."),
    ).toBeTruthy();
    expect(document.querySelector("video")).toBeNull();
  });
});

describe("captions", () => {
  it("renders a track when the author supplied one", () => {
    // WCAG 1.2.2 is Level A: a physician who cannot hear the video cannot earn
    // the points, and the watch gate faithfully records that they did not.
    const { container } = renderPlayer();
    const track = container.querySelector("track");
    expect(track?.getAttribute("src")).toBe("https://cdn/x.vtt");
    expect(track?.getAttribute("kind")).toBe("captions");
    expect(track?.getAttribute("srclang")).toBe("de");
  });

  it("renders none, and no toggle, when there is no track", () => {
    // An empty <track> offers a captions control that produces nothing, which
    // reads as broken captions rather than absent ones.
    const { container } = renderPlayer({ captionsUrl: null });
    expect(container.querySelector("track")).toBeNull();
    expect(screen.queryByText("Untertitel ausblenden")).toBeNull();
  });

  it("offers a toggle that reports its own state", () => {
    renderPlayer();
    const toggle = screen.getByRole("button", { name: "Untertitel ausblenden" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: "Untertitel einblenden" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("the scrub bar", () => {
  function bars(container: HTMLElement, className: string): DOMRect[] | string[] {
    return [...container.querySelectorAll(`span.${className}`)].map(
      (node) => (node as HTMLElement).style.width,
    );
  }

  it("shades the passages the server credited", () => {
    // The only place a learner sees what the CME gate has counted.
    const { container } = renderPlayer({
      watchedSegments: [
        { startSec: 0, endSec: 309 },
        { startSec: 772.5, endSec: 1081.5 },
      ],
    });
    // 309/1545 = 20 %, twice.
    expect(bars(container, "bg-brand-300")).toEqual(["20%", "20%"]);
  });

  it("merges overlapping passages rather than stacking them", () => {
    // Stacked translucent blocks make a re-watched passage look *more*
    // complete than one seen once — the opposite of what union coverage means.
    const { container } = renderPlayer({
      watchedSegments: [
        { startSec: 0, endSec: 309 },
        { startSec: 154.5, endSec: 463.5 },
      ],
    });
    expect(bars(container, "bg-brand-300")).toEqual(["30%"]);
  });

  it("draws nothing before anything is watched", () => {
    const { container } = renderPlayer({ watchedSegments: [] });
    expect(bars(container, "bg-brand-300")).toEqual([]);
  });

  it("announces its position against the authored length", () => {
    // jsdom reports `duration: NaN`; a bar reading the element would announce
    // "14:35 von NaN:NaN" to a screen reader.
    renderPlayer();
    const slider = screen.getByRole("slider", { name: "Wiedergabeposition" });
    expect(slider.getAttribute("aria-valuetext")).toBe("14:35 von 25:45");
    expect(slider.getAttribute("aria-valuemax")).toBe("1545");
  });

  it("is operable from the keyboard", () => {
    const { props } = renderPlayer();
    const slider = screen.getByRole("slider", { name: "Wiedergabeposition" });

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "End" });
    // jsdom will not move a media element's currentTime, so what is asserted is
    // that the handler ran rather than the resulting position.
    expect(props.onPlayback).toHaveBeenCalled();
  });
});

describe("forward seeking", () => {
  /**
   * jsdom will not move a real media element, so the element's `currentTime`
   * is replaced with a plain accessor that records what was written to it.
   * What is under test is the *value the player computes*, which is the part
   * that decides whether a physician can skip a video and still be credited.
   */
  function trackedPlayer(over: Partial<React.ComponentProps<typeof VideoPlayer>> = {}) {
    const rendered = renderPlayer(over);
    const video = rendered.container.querySelector("video") as HTMLVideoElement;
    let current = 0;
    const writes: number[] = [];
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => current,
      set: (value: number) => {
        current = value;
        writes.push(value);
      },
    });
    return { ...rendered, video, writes, at: () => current };
  }

  it("stops a drag to the end at what has actually been watched", () => {
    // Five minutes watched of a 25-minute module: dragging to the end lands at
    // 5:05, not at 25:45. The clamp is what makes the accreditation's "must be
    // seen" visible in the control rather than only in a withheld point.
    const { writes } = trackedPlayer({ seekCeilingSec: 305, startAtSec: 0 });
    const slider = screen.getByRole("slider", { name: "Wiedergabeposition" });

    fireEvent.keyDown(slider, { key: "End" });

    expect(writes.at(-1)).toBe(305);
  });

  it("leaves backwards seeking alone", () => {
    // Re-watching is legitimate and free — a union counts each second once —
    // so nothing here may punish it.
    const { writes } = trackedPlayer({ seekCeilingSec: 305, startAtSec: 0 });
    const slider = screen.getByRole("slider", { name: "Wiedergabeposition" });

    fireEvent.keyDown(slider, { key: "Home" });

    expect(writes.at(-1)).toBe(0);
  });

  it("stops the arrow keys and the digit shortcuts at the same place", () => {
    // Every seek path goes through one clamp. A shortcut that forgot it would
    // be a hole in the gate that nothing else in the interface reveals.
    const { container, writes } = trackedPlayer({ seekCeilingSec: 120, startAtSec: 0 });
    const player = container.querySelector('[aria-label="Modul 3 — Diagnostik"]');
    if (player === null) throw new Error("player container not found");

    fireEvent.keyDown(player, { key: "ArrowRight" });
    expect(writes.at(-1)).toBe(5);

    fireEvent.keyDown(player, { key: "9" });
    // 90 % of 25:45 is 23:10 — refused, and 2:00 is offered instead.
    expect(writes.at(-1)).toBe(120);

    fireEvent.keyDown(player, { key: "l" });
    expect(writes.at(-1)).toBe(120);
  });

  it("snaps back a position set by something it does not own", () => {
    // Picture-in-Picture's own scrub bar, media keys, iOS fullscreen controls.
    // They move the element directly, so the element's own `seeking` event is
    // the only place they can be caught.
    const { video, at } = trackedPlayer({ seekCeilingSec: 120, startAtSec: 0 });

    video.currentTime = 1400;
    fireEvent.seeking(video);

    expect(at()).toBe(120);
  });

  it("lets a playing video pass the ceiling it was given", () => {
    // The ceiling is only as fresh as the last flush, fifteen seconds apart.
    // Enforcing it literally would drag a learner watching normally backwards,
    // which is precisely the wrong person to punish.
    const { video, at } = trackedPlayer({ seekCeilingSec: 60, startAtSec: 0 });
    Object.defineProperty(video, "paused", { value: false, configurable: true });

    video.currentTime = 75;
    fireEvent.timeUpdate(video);
    fireEvent.seeking(video);

    expect(at()).toBe(75);
  });

  it("does not let a seek raise its own ceiling", () => {
    // If a seek counted as "reached", one refused drag would authorise the
    // next one and the limit would walk itself to the end of the video.
    const { video, at } = trackedPlayer({ seekCeilingSec: 60, startAtSec: 0 });

    video.currentTime = 900;
    fireEvent.seeking(video);
    expect(at()).toBe(60);

    video.currentTime = 900;
    fireEvent.seeking(video);
    expect(at()).toBe(60);
  });

  it("says why the bar will not move, and only while it will not", () => {
    // A control that silently refuses reads as broken, and the learner's next
    // move is to reload the page.
    renderPlayer({ seekCeilingSec: 305, startAtSec: 300 });
    expect(screen.getByText(/Vorspulen ist nicht möglich/)).toBeTruthy();

    cleanup();
    renderPlayer({ seekCeilingSec: 1545 });
    expect(screen.queryByText(/Vorspulen ist nicht möglich/)).toBeNull();
  });

  it("announces the restricted range rather than the full one", () => {
    // `aria-valuemax` is what the slider can be *set* to. Announcing 25:45 for
    // a control that refuses to pass 5:05 describes a different widget.
    //
    // The pair is coherent on purpose: the API caps `resumeAtSec` at
    // `seekCeilingSec`, so a video never opens at a position it would then
    // refuse to seek back to.
    renderPlayer({ seekCeilingSec: 305, startAtSec: 300 });
    const slider = screen.getByRole("slider", { name: "Wiedergabeposition" });

    expect(slider.getAttribute("aria-valuemax")).toBe("305");
    expect(slider.getAttribute("aria-valuetext")).toBe(
      "5:00 von 25:45, freigegeben bis 5:05",
    );
  });

  it("imposes nothing when the server sent no ceiling", () => {
    // A missing field must not lock the player: the gate is the union of
    // reported intervals, and locking would cost every learner for no gain.
    const { writes } = trackedPlayer({ seekCeilingSec: null, startAtSec: 0 });
    const slider = screen.getByRole("slider", { name: "Wiedergabeposition" });

    fireEvent.keyDown(slider, { key: "End" });

    expect(writes.at(-1)).toBe(1545);
    expect(screen.queryByText(/Vorspulen ist nicht möglich/)).toBeNull();
  });
});

describe("the controls", () => {
  it("gives every control an accessible name", () => {
    // The icons are `aria-hidden`; these names are the only thing a screen
    // reader has, and the alternative is a CME course a blind physician cannot
    // complete.
    renderPlayer();
    // Not Bild-in-Bild: it is rendered only where the browser supports it,
    // because a button that does nothing is worse than an absent one.
    for (const name of ["Abspielen", "Ton aus", "Vollbild"]) {
      expect(screen.queryAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("slider", { name: "Wiedergabeposition" })).toBeTruthy();
    expect(screen.getByLabelText("Lautstärke")).toBeTruthy();
  });

  it("shows how much is left rather than repeating the panel's clock", () => {
    // The elapsed/total pair lives in the progress panel above (layout §4.3).
    // Two identical clocks a hundred pixels apart is noise; "noch 11:10" is the
    // reading the panel does not have.
    renderPlayer();
    expect(screen.getByText("noch 11:10")).toBeTruthy();
    expect(screen.queryByText("14:35 / 25:45")).toBeNull();
  });

  it("cycles the speed and never offers one the server would refuse to credit", () => {
    // The API rejects a report claiming more media seconds than wall-clock
    // allows, so a rate above 2× silently costs the learner watch time.
    renderPlayer();
    const speed = screen.getByRole("button", { name: /Geschwindigkeit/ });
    expect(speed.textContent).toBe("Normal");
    for (let i = 0; i < 12; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: /Geschwindigkeit/ }));
      const label =
        screen.getByRole("button", { name: /Geschwindigkeit/ }).textContent ?? "";
      const rate =
        label === "Normal" ? 1 : Number(label.replace("×", "").replace(",", "."));
      expect(rate).toBeLessThanOrEqual(2);
    }
  });

  it("lists its keyboard shortcuts, so they are discoverable", () => {
    renderPlayer();
    expect(screen.getByText("Tastaturkürzel")).toBeTruthy();
    expect(screen.getByText("Abspielen oder pausieren")).toBeTruthy();
  });
});

describe("failures", () => {
  function failWith(code: number) {
    const { container, props } = renderPlayer();
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "error", { value: { code }, configurable: true });
    fireEvent.error(video);
    return props;
  }

  it("names the failure rather than saying it did not play", () => {
    failWith(2 /* MEDIA_ERR_NETWORK */);
    expect(screen.getByText(/Verbindung/)).toBeTruthy();

    cleanup();
    failWith(3 /* MEDIA_ERR_DECODE */);
    expect(screen.getByText(/beschädigt/)).toBeTruthy();

    cleanup();
    failWith(4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */);
    // Twice on purpose: once in the overlay, and once as the <video> element's
    // own fallback content for a browser with no media support at all.
    expect(screen.getAllByText(/aktuellen Browser/)).toHaveLength(2);
  });

  it("offers a retry only where retrying could help", () => {
    // A network failure is worth another attempt. A codec the browser cannot
    // decode will not decode on the second try, and a retry button that always
    // fails teaches a learner the player is broken.
    failWith(2);
    expect(screen.getByRole("button", { name: "Erneut laden" })).toBeTruthy();

    cleanup();
    failWith(3);
    expect(screen.queryByRole("button", { name: "Erneut laden" })).toBeNull();
  });

  it("reports the failure as an alert, since the learner did not cause it", () => {
    failWith(2);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("reporting upward", () => {
  it("feeds every tick to the watch tracker, not only whole seconds", () => {
    // The tracker treats a gap beyond its tolerance as a seek. Sampling coarsely
    // would manufacture gaps and lose genuinely watched time.
    const { container, props } = renderPlayer();
    const video = container.querySelector("video") as HTMLVideoElement;

    Object.defineProperty(video, "currentTime", { value: 10.1, configurable: true });
    fireEvent.timeUpdate(video);
    Object.defineProperty(video, "currentTime", { value: 10.4, configurable: true });
    fireEvent.timeUpdate(video);

    expect(props.onTick).toHaveBeenCalledTimes(2);
  });

  it("tells the chrome when playback stopped, and why", () => {
    const onStop = vi.fn<(reason: "pause" | "seek" | "ended") => void>();
    const { container } = renderPlayer({ onStop });
    const video = container.querySelector("video") as HTMLVideoElement;

    fireEvent.pause(video);
    fireEvent.seeking(video);
    fireEvent.ended(video);

    // The reason is what decides whether the intervals are flushed: a pause is
    // the learner stopping and gets a request; a seek would otherwise fire one
    // per frame of a scrub-bar drag.
    expect(onStop.mock.calls.map(([reason]) => reason)).toEqual([
      "pause",
      "seek",
      "ended",
    ]);
  });
});

/**
 * Which refusal the learner is looking at (P62-03).
 *
 * "The server will not seek" and "you have not watched that far" produce the
 * identical snap-back. Section 9 spent an hour on the wrong one, with the
 * anti-skip sentence on screen the whole time — a misconfigured host reading
 * as a working feature is the worst possible failure mode for a check, because
 * it recruits the product into the lie.
 *
 * jsdom has no media pipeline, so `video.seekable` is stubbed. That is the
 * honest boundary of what a component test can assert here: the *wiring* from
 * the element's report to the sentence. Whether a given host actually answers
 * `206` is the admin check's question, not this one.
 */
describe("a host that cannot seek at all", () => {
  function withSeekable(length: number) {
    const { container, props } = renderPlayer({
      seekCeilingSec: 200,
      watchedSegments: [{ startSec: 0, endSec: 200 }],
    });
    const video = container.querySelector("video");
    if (video === null) throw new Error("no video element");
    Object.defineProperty(video, "seekable", {
      configurable: true,
      get: () => ({ length }),
    });
    Object.defineProperty(video, "readyState", { configurable: true, get: () => 1 });
    Object.defineProperty(video, "buffered", {
      configurable: true,
      get: () => ({ length: 0 }),
    });
    fireEvent.progress(video);
    return { container, props };
  }

  it("says it is the server, not the learner", () => {
    withSeekable(0);
    expect(screen.getByText(/der Videoserver unterstützt das nicht/)).toBeTruthy();
    // And not the accreditation wording, which would send the learner away
    // believing the product is working.
    expect(screen.queryByText(/Vorspulen ist nicht möglich/)).toBeNull();
  });

  it("tells them what to do about it", () => {
    // A refusal a learner cannot act on is a refusal that generates a support
    // ticket about the wrong thing (CLAUDE.md §9.4).
    withSeekable(0);
    expect(screen.getByText(/melden Sie das dem Veranstalter/)).toBeTruthy();
  });

  it("keeps the accreditation wording when seeking works and the gate bites", () => {
    withSeekable(1);
    expect(screen.getByText(/Vorspulen ist nicht möglich/)).toBeTruthy();
    expect(screen.queryByText(/der Videoserver unterstützt das nicht/)).toBeNull();
  });
});
