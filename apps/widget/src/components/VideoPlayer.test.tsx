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

/**
 * The element, not a render — so a test can hand the *same* component new
 * props through `rerender`.
 *
 * That distinction is the whole subject of "keeps what it has watched when a
 * progress flush brings a new ceiling" below: what the client hit only happens
 * on a re-render of a mounted player, and a helper that could only mount would
 * have made that case unwritable.
 */
function playerWith(over: Partial<React.ComponentProps<typeof VideoPlayer>> = {}) {
  const props = {
    sources,
    posterUrl: "https://cdn/x.jpg",
    captionsUrl: "https://cdn/x.vtt",
    title: "Modul 3 — Diagnostik",
    contentId: "content-1",
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
  return <VideoPlayer {...props} />;
}

function renderPlayer(over: Partial<React.ComponentProps<typeof VideoPlayer>> = {}) {
  const element = playerWith(over);
  return { ...render(element), props: element.props };
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

  /**
   * Resuming where the learner left off (P120-02).
   *
   * ## Why this was missing
   *
   * `startAtSec: 875` has been in this file's default fixture since the prop
   * existed, and **nothing asserted the element ever opens there** — every case
   * that cares about seeking overrides it to 0, which is the honest thing for
   * those cases and left the resume itself covered by nobody.
   *
   * The rule is exhaustively tested (`resume.test.ts`: 875 → 840) and the API
   * returns it (`learning-flow`: `resumeAtSec` is 540 after a position of 600).
   * Between those two and the screen sat one `handleLoadedMetadata`, untested —
   * §9.7 exactly: name the caller, or the call site is what is untested.
   *
   * The client asked for this behaviour by describing it: *"I am watching a
   * video which is 18 minutes, at 12:34 i pause or close the window, and after
   * a day i resume … my video starts from 12:01."*
   */
  it("opens where the learner left off, once the element knows its duration", () => {
    const { video, at } = trackedPlayer({ startAtSec: 840, seekCeilingSec: 845 });

    // Before metadata there is no duration, and every browser silently
    // discards a `currentTime` written this early. Asserting the *order* is
    // the point: a resume applied on mount is a resume that does not happen.
    expect(at()).toBe(0);

    Object.defineProperty(video, "duration", { configurable: true, value: 1080 });
    fireEvent.loadedMetadata(video);

    expect(at()).toBe(840);
  });

  it("does not seek past the end of a video shorter than the stored position", () => {
    // A re-encoded or replaced file is shorter than the one the position was
    // recorded against. Seeking beyond `duration` leaves the element in a state
    // that presents as a player that will not start.
    const { video, at } = trackedPlayer({ startAtSec: 840, seekCeilingSec: 845 });

    Object.defineProperty(video, "duration", { configurable: true, value: 300 });
    fireEvent.loadedMetadata(video);

    expect(at()).toBe(300);
  });

  it("leaves a learner who is already somewhere alone", () => {
    /*
     * The control. `handleLoadedMetadata` can fire more than once — a source
     * change, a re-range, a codec switch — and a resume that re-applied itself
     * would drag somebody backwards mid-lesson, which is the report P71-01 was.
     */
    const { video, at } = trackedPlayer({ startAtSec: 840, seekCeilingSec: 845 });

    Object.defineProperty(video, "duration", { configurable: true, value: 1080 });
    fireEvent.loadedMetadata(video);
    video.currentTime = 900;
    fireEvent.loadedMetadata(video);

    expect(at()).toBe(900);
  });

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

  /*
   * The client's report, on 13.08 (P71-01):
   *
   *   > "suddenly the video stops and when i press again it goes to start of
   *   > the video, the video player is not robust"
   *
   * `reachedRef` exists so that a playing video is not dragged back to the last
   * flushed second — the test above asserts exactly that. What neither of them
   * exercised is the event that *destroys* it: a **new** ceiling arriving,
   * which is what a progress flush produces every fifteen seconds on the same
   * lesson. The reset effect said "a different lesson starts its own session"
   * and listed `seekCeilingSec` among its dependencies.
   *
   * So the watermark was thrown away four times a minute, the limit collapsed
   * back to the stale ceiling, and the next `seeking` event — the browser's
   * own, during buffering, or PiP, or a media key — yanked the playhead to it.
   */
  it("keeps what it has watched when a progress flush brings a new ceiling", () => {
    const { video, at, rerender } = trackedPlayer({
      seekCeilingSec: 25,
      startAtSec: 0,
    });
    Object.defineProperty(video, "paused", { value: false, configurable: true });

    // Watched to 0:37. The ceiling is behind the playhead, which is the
    // *ordinary* state between flushes and the entire reason the watermark
    // exists — a flush covers up to the moment it was sent, not to now.
    video.currentTime = 37;
    fireEvent.timeUpdate(video);

    // The flush lands: a new ceiling, on the same lesson, still behind. This
    // is the every-fifteen-seconds event, not an edge case.
    rerender(playerWith({ seekCeilingSec: 30, startAtSec: 0 }));

    fireEvent.seeking(video);

    // Not 30. A learner who has watched every second up to 0:37 is the wrong
    // person to drag backwards.
    expect(at()).toBe(37);
  });

  it("still starts a new session when the lesson changes", () => {
    // The negative, and the reason the fix is keyed on the content rather than
    // on nothing: a second video in the same mounted player must not inherit
    // the first one's watermark, or finishing module 1 would unlock module 2's
    // scrub bar.
    const { video, at, rerender } = trackedPlayer({
      seekCeilingSec: 60,
      startAtSec: 0,
      contentId: "content-1",
    });
    Object.defineProperty(video, "paused", { value: false, configurable: true });

    video.currentTime = 900;
    fireEvent.timeUpdate(video);

    rerender(playerWith({ seekCeilingSec: 60, startAtSec: 0, contentId: "content-2" }));

    video.currentTime = 900;
    fireEvent.seeking(video);

    expect(at()).toBe(60);
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

describe("clicking the picture", () => {
  /*
   * P106-02. The client: *"when video is being played, clicking one more time
   * on it, the click doesn't stop the video."*
   *
   * The cause was a condition, not a missing feature: the centred play button
   * covered the whole picture and was rendered `!state.playing`, so the first
   * click started playback and removed the only thing that could receive the
   * second. Nothing was broken enough to notice from the code — the button
   * worked, the shortcut worked, the Controls button worked — and clicking a
   * video is what every physician does without thinking about it.
   *
   * jsdom implements no media pipeline, so `paused` is redefined and `pause` is
   * a spy. That is enough: what is under test is which control exists and what
   * it calls, not whether a video decodes.
   */
  function playing() {
    const { container } = renderPlayer();
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    video.pause = vi.fn();
    fireEvent.play(video);
    return { container, video };
  }

  function surface(container: HTMLElement): HTMLButtonElement {
    const node = container.querySelector('[data-ds-control="surface"]');
    if (node === null) throw new Error("the video has no click surface");
    return node as HTMLButtonElement;
  }

  it("pauses a video that is playing", () => {
    const { container, video } = playing();
    fireEvent.click(surface(container));
    expect(video.pause).toHaveBeenCalled();
  });

  it("is labelled for what the next click will do", () => {
    // Not decoration: it is the accessible name of a control covering the
    // whole picture, and "Abspielen" on a playing video is a lie.
    const { container } = renderPlayer();
    expect(surface(container).getAttribute("aria-label")).toBe("Abspielen");

    cleanup();
    const started = playing();
    expect(surface(started.container).getAttribute("aria-label")).toBe("Pause");
  });

  it("draws the centred play button only while stopped", () => {
    // The surface stays; what is drawn in it does not. A play circle sitting
    // over a running video is the same defect from the other side.
    const { container } = renderPlayer();
    expect(surface(container).querySelector("svg")).not.toBeNull();

    cleanup();
    const started = playing();
    expect(surface(started.container).querySelector("svg")).toBeNull();
  });

  it("adds no second stop to the tab order", () => {
    // The Controls bar already has a visible play/pause button with the same
    // name. Two, one of them invisible, is a keyboard user tabbing through
    // nothing.
    const { container } = renderPlayer();
    expect(surface(container).getAttribute("tabindex")).toBe("-1");
  });

  it("gets out of the way of a failure", () => {
    // On an error the overlay underneath carries the message and the retry.
    // A transparent full-size button over it would swallow both.
    const { container } = renderPlayer();
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "error", { value: { code: 2 }, configurable: true });
    fireEvent.error(video);

    expect(container.querySelector('[data-ds-control="surface"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Erneut laden" })).toBeTruthy();
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
