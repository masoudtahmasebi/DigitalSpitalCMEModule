/**
 * The `<ds-lms>` custom element (P5-01).
 *
 * ## Why a Shadow DOM custom element rather than a mounted SPA
 *
 * This runs inside somebody else's WordPress theme. A theme can and will ship
 * `* { box-sizing: content-box }`, a global `button` rule, or a CSS reset that
 * lands after our stylesheet. An open DOM subtree would inherit all of it and
 * the widget's appearance would depend on the client's next theme update.
 * A closed shadow root ends that: the host page's CSS cannot reach in, and —
 * equally important — Tailwind's utilities cannot leak out onto the host page's
 * own markup.
 *
 * `mode: "closed"` specifically: nothing outside needs to reach into the
 * widget's internals, and a page script that could would be able to read a
 * physician's participation data out of the DOM.
 *
 * ## Configuration
 *
 * ```html
 * <ds-lms
 *   api-base="https://api.example.de"
 *   project="medice-adhs"
 *   course="adhs-akademie-adult"
 *   token-endpoint="/wp-json/ds-lms/v1/token"
 * ></ds-lms>
 * ```
 *
 * `project` is the `X-DS-Project` header (ADR-0007): it tells the API which
 * host surface is calling, which resolves the Keycloak realm the token is
 * validated against and pins the tenant. It is not a secret and not a
 * credential — presenting it grants nothing on its own.
 *
 * Attributes are read once at connect time. They are page configuration, not
 * state; re-reading them would invite a host page to swap the course slug
 * underneath a learner mid-video, which has no sensible meaning for progress
 * already recorded.
 */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
// The built Tailwind output, as a string — see vite.config.ts.
import styles from "./styles.css?inline";
import { App } from "./App.js";
import { cachingProvider, resolveTokenProvider, type TokenProvider } from "./token.js";

export const WIDGET_ELEMENT_NAME = "ds-lms";

export class DsLmsElement extends HTMLElement {
  /** Set by the host page before or after insertion — see `token.ts`. */
  tokenProvider?: TokenProvider;

  #root: Root | undefined;
  #shadow: ShadowRoot | undefined;

  connectedCallback(): void {
    if (this.#root !== undefined) return;

    const shadow = this.attachShadow({ mode: "closed" });
    this.#shadow = shadow;
    adoptStyles(shadow, styles);

    const mount = document.createElement("div");
    // The class every Tailwind rule is scoped under (tailwind.config.js).
    mount.className = "ds-lms-root";
    shadow.append(mount);

    const provider = resolveTokenProvider({
      provider: this.tokenProvider,
      endpoint: this.getAttribute("token-endpoint") ?? undefined,
    });

    this.#root = createRoot(mount);
    this.#root.render(
      createElement(App, {
        apiBase: this.getAttribute("api-base") ?? "",
        projectSlug: this.getAttribute("project") ?? "",
        courseSlug: this.getAttribute("course") ?? "",
        getToken: provider === undefined ? undefined : cachingProvider(provider),
      }),
    );
  }

  disconnectedCallback(): void {
    // Deferred: React warns when a root is unmounted while it is rendering,
    // and a custom element can be moved in the DOM (which fires disconnect
    // then connect synchronously) rather than genuinely removed.
    const root = this.#root;
    this.#root = undefined;
    this.#shadow = undefined;
    queueMicrotask(() => root?.unmount());
  }

  /** Exposed for tests: the shadow root is closed, so nothing else can see it. */
  get shadowRootForTest(): ShadowRoot | undefined {
    return this.#shadow;
  }
}

/**
 * Adopts the stylesheet, preferring constructable stylesheets.
 *
 * `adoptedStyleSheets` shares one parsed sheet across every instance on the
 * page; the `<style>` fallback re-parses per instance. Both are correct, so
 * the fallback is not a compatibility concern — it is only slower, and it
 * keeps the widget working in a browser that lacks the newer API.
 */
function adoptStyles(shadow: ShadowRoot, css: string): void {
  if (typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
    return;
  }

  const style = document.createElement("style");
  style.textContent = css;
  shadow.append(style);
}

/**
 * Registers the element, once.
 *
 * Idempotent because a WordPress page can end up with the bundle enqueued
 * twice — two plugins, or a cached page plus a fresh one — and
 * `customElements.define` throws on a duplicate name, which would take down
 * the whole script.
 */
export function registerWidget(): void {
  if (customElements.get(WIDGET_ELEMENT_NAME) === undefined) {
    customElements.define(WIDGET_ELEMENT_NAME, DsLmsElement);
  }
}
