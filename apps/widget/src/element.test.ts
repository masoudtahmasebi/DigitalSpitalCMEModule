/**
 * The DOM contract with the host page.
 *
 * These are the assertions a WordPress integration breaks first: the element
 * has to register once, isolate its styles, read its configuration, and refuse
 * clearly when the page forgot something. Everything below is about the
 * boundary, not about React.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DsLmsElement, registerWidget, WIDGET_ELEMENT_NAME } from "./element.js";

registerWidget();

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

/** Renders synchronously enough for React to have flushed its first commit. */
async function mount(html: string): Promise<DsLmsElement> {
  host.innerHTML = html;
  const element = host.querySelector(WIDGET_ELEMENT_NAME);
  if (!(element instanceof DsLmsElement)) throw new Error("element did not upgrade");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return element;
}

describe("registration", () => {
  it("registers the element under its documented name", () => {
    expect(customElements.get(WIDGET_ELEMENT_NAME)).toBe(DsLmsElement);
  });

  it("survives being registered twice", () => {
    // A WordPress page can end up with the bundle enqueued twice — two
    // plugins, or a cached page plus a fresh one. `customElements.define`
    // throws on a duplicate, which would take down the whole script.
    expect(() => {
      registerWidget();
      registerWidget();
    }).not.toThrow();
  });

  it("upgrades markup that was already parsed", async () => {
    const element = await mount("<ds-lms></ds-lms>");
    expect(element).toBeInstanceOf(DsLmsElement);
  });
});

describe("isolation", () => {
  it("attaches a closed shadow root", async () => {
    const element = await mount("<ds-lms></ds-lms>");

    // Closed: a page script must not be able to read a physician's
    // participation data out of the widget's DOM.
    expect(element.shadowRoot).toBeNull();
    expect(element.shadowRootForTest).toBeDefined();
  });

  it("puts its styles inside the shadow root, not the document", async () => {
    const before = document.head.querySelectorAll("style").length;
    const element = await mount("<ds-lms></ds-lms>");

    const shadow = element.shadowRootForTest;
    const hasStyles =
      (shadow?.adoptedStyleSheets?.length ?? 0) > 0 ||
      (shadow?.querySelectorAll("style").length ?? 0) > 0;

    expect(hasStyles).toBe(true);
    // Nothing leaked out onto the host page.
    expect(document.head.querySelectorAll("style").length).toBe(before);
  });

  it("scopes everything under the wrapper Tailwind is compiled against", async () => {
    const element = await mount("<ds-lms></ds-lms>");
    expect(element.shadowRootForTest?.querySelector(".ds-lms-root")).not.toBeNull();
  });
});

describe("configuration", () => {
  it("refuses clearly when the page did not configure it", async () => {
    // A missing attribute is a page-integration mistake. It gets one sentence,
    // not a wall of failed requests the learner cannot act on.
    const element = await mount("<ds-lms></ds-lms>");
    const text = element.shadowRootForTest?.textContent ?? "";

    expect(text).toContain("nicht korrekt eingebunden");
  });

  it("refuses when configured but given no way to get a token", async () => {
    // Deliberately not a silent unauthenticated attempt: the widget never
    // guesses that a user is signed in (CLAUDE.md §4 invariant 2).
    const element = await mount(
      `<ds-lms api-base="https://api.test" project="p" course="c"></ds-lms>`,
    );

    expect(element.shadowRootForTest?.textContent ?? "").toContain(
      "nicht korrekt eingebunden",
    );
  });

  it("keeps a provider set before the element upgraded", async () => {
    // The WordPress ordering, and the one that fails silently: the plugin's
    // inline script runs *before* the deferred module that defines the
    // element, so the property lands on a plain HTMLUnknownElement. A class
    // field would erase it in the constructor at upgrade time, and the widget
    // would claim it was not configured on a page configured perfectly.
    //
    // Parsed in a foreign document on purpose: `document.createElement` in
    // this one upgrades immediately, since the element is already defined —
    // which would make this assertion pass whether or not the bug exists.
    const foreign = new DOMParser().parseFromString(
      `<ds-lms api-base="https://api.test" project="medice-adhs" course="adhs-akademie-adult"></ds-lms>`,
      "text/html",
    );
    const raw = foreign.querySelector("ds-lms")!;
    expect(raw).not.toBeInstanceOf(DsLmsElement);

    (raw as unknown as { tokenProvider: unknown }).tokenProvider = async () => "early";

    // Adopting into this document is what triggers the upgrade.
    host.append(document.adoptNode(raw));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(raw).toBeInstanceOf(DsLmsElement);
    const upgraded = raw as unknown as DsLmsElement;
    expect(await upgraded.tokenProvider?.({ refresh: false })).toBe("early");
    expect(upgraded.shadowRootForTest?.textContent ?? "").not.toContain(
      "nicht korrekt eingebunden",
    );
  });

  it("accepts a token provider set as a property before insertion", async () => {
    // The documented escape hatch for a host page that already holds a token.
    const element = new DsLmsElement();
    element.setAttribute("api-base", "https://api.test");
    element.setAttribute("project", "medice-adhs");
    element.setAttribute("course", "adhs-akademie-adult");
    element.tokenProvider = async () => "token";

    host.append(element);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // It got past the configuration check and started loading.
    expect(element.shadowRootForTest?.textContent ?? "").not.toContain(
      "nicht korrekt eingebunden",
    );
  });
});

describe("white-label branding", () => {
  const branding = {
    primaryColor: "#0a7f4b",
    fontFamily: "Inter, system-ui, sans-serif",
    fontFamilyName: "Medice Sans",
    fontVersion: "2026-07-28T12:00:00.000Z",
  };

  /** Answers `/branding` with the given record and nothing else. */
  function stubBranding(record: unknown): void {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/branding")) {
        return new Response(JSON.stringify(record), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const style of document.head.querySelectorAll("style[id^='ds-lms-font-']")) {
      style.remove();
    }
  });

  it("declares the uploaded font in the document, not the shadow root", async () => {
    // Chrome does not apply an `@font-face` declared inside a shadow root: the
    // rule parses, the file never loads, and the fallback stack renders — which
    // reads as a broken upload rather than as a scoping rule. This assertion is
    // the only thing standing between that and a customer's rebrand silently
    // doing nothing.
    const element = await mountWith(branding);

    const injected = document.head.querySelector("style[id^='ds-lms-font-']");
    expect(injected?.textContent).toContain('font-family:"Medice Sans"');
    // On our own origin, with the project as a query parameter — a font
    // fetched from CSS carries no custom header to put the slug in.
    expect(injected?.textContent).toContain("/branding/font?project=medice-adhs");
    expect(injected?.textContent).toContain("v=2026-07-28T12%3A00%3A00.000Z");

    // And nothing extra leaked: the widget's own styles stay scoped.
    const shadowStyles = element.shadowRootForTest?.querySelectorAll("style") ?? [];
    for (const style of shadowStyles) {
      expect(style.textContent ?? "").not.toContain("@font-face");
    }
  });

  it("declares it once however many widgets are on the page", async () => {
    await mountWith(branding);
    await mountWith(branding);

    expect(document.head.querySelectorAll("style[id^='ds-lms-font-']")).toHaveLength(1);
  });

  it("declares nothing when the customer has not uploaded a font", async () => {
    await mountWith({ primaryColor: "#0a7f4b" });
    expect(document.head.querySelector("style[id^='ds-lms-font-']")).toBeNull();
  });

  it("declares nothing for a family name that would break out of the rule", async () => {
    // The API validates on write and again on read; the widget validates a
    // third time because this is where the value becomes CSS on a page that
    // holds a bearer token.
    await mountWith({
      ...branding,
      fontFamilyName: 'X"}body{display:none}@font-face{font-family:"Y',
    });

    expect(document.head.querySelector("style[id^='ds-lms-font-']")).toBeNull();
  });

  async function mountWith(record: unknown): Promise<DsLmsElement> {
    stubBranding(record);
    const element = await mount(
      `<ds-lms api-base="https://api.test" project="medice-adhs" course="c"></ds-lms>`,
    );
    // The branding fetch is deliberately not awaited by connectedCallback —
    // a logo must never block the first render.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return element;
  }
});

describe("lifecycle", () => {
  it("tears down cleanly when removed", async () => {
    const element = await mount("<ds-lms></ds-lms>");
    element.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(element.shadowRootForTest).toBeUndefined();
  });

  it("does not mount twice if connected twice", async () => {
    // A custom element can be moved in the DOM, which fires disconnect then
    // connect. Attaching a second shadow root would throw.
    const element = await mount("<ds-lms></ds-lms>");
    expect(() => element.connectedCallback()).not.toThrow();
  });
});
