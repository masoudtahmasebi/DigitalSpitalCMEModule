/**
 * The DOM contract with the host page.
 *
 * These are the assertions a WordPress integration breaks first: the element
 * has to register once, isolate its styles, read its configuration, and refuse
 * clearly when the page forgot something. Everything below is about the
 * boundary, not about React.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
