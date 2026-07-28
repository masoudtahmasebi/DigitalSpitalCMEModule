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
import { brandingCssVariables, parseBranding } from "@ds/domain";
import { App } from "./App.js";
import { cachingProvider, resolveTokenProvider, type TokenProvider } from "./token.js";

export const WIDGET_ELEMENT_NAME = "ds-lms";

export class DsLmsElement extends HTMLElement {
  #tokenProvider: TokenProvider | undefined;
  #root: Root | undefined;
  #shadow: ShadowRoot | undefined;

  /**
   * Set by the host page, before or after the element upgrades — see
   * `token.ts`.
   *
   * An accessor pair rather than a plain field, and this is not a style
   * choice. A class field compiles to a `[[Define]]` in the constructor, and
   * the constructor runs at *upgrade* time. A host page that does
   *
   *     element.tokenProvider = provider;   // element not yet upgraded
   *
   * creates an own data property, which the field definition then overwrites
   * with `undefined` the moment the bundle loads. The widget would render
   * "not correctly embedded" on a page that had configured it perfectly.
   *
   * That ordering is not hypothetical — it is exactly what the WordPress
   * plugin does, because its inline script runs before the deferred module
   * that defines the element. So the property lives on the prototype, and
   * `#upgradeProperty` re-applies anything that was set early.
   */
  get tokenProvider(): TokenProvider | undefined {
    return this.#tokenProvider;
  }

  set tokenProvider(value: TokenProvider | undefined) {
    this.#tokenProvider = value;
  }

  connectedCallback(): void {
    if (this.#root !== undefined) return;

    // Must run before anything reads the provider.
    this.#upgradeProperty("tokenProvider");

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

    const apiBase = this.getAttribute("api-base") ?? "";
    const projectSlug = this.getAttribute("project") ?? "";

    // Applied to the wrapper as soon as it arrives, independently of React.
    // Branding must reach the loading and error states too, and those render
    // before — or instead of — anything the token can fetch.
    void this.#applyBranding(mount, apiBase, projectSlug);

    this.#root = createRoot(mount);
    this.#root.render(
      createElement(App, {
        apiBase,
        projectSlug,
        courseSlug: this.getAttribute("course") ?? "",
        getToken: provider === undefined ? undefined : cachingProvider(provider),
      }),
    );
  }

  /**
   * Fetch the project's branding and set it as CSS custom properties.
   *
   * Unauthenticated, because it has to work before a token exists. Failure is
   * silent and deliberately so: an unbranded widget is a cosmetic problem, and
   * an error banner about a logo would be worse than the missing logo.
   *
   * The values are re-validated here by `parseBranding` even though the API
   * already validated them. This is the point where a string becomes CSS, and
   * the widget does not get to assume the response came from an API it trusts.
   */
  async #applyBranding(
    mount: HTMLElement,
    apiBase: string,
    projectSlug: string,
  ): Promise<void> {
    if (apiBase === "" || projectSlug === "") return;

    try {
      const response = await fetch(new URL("/branding", apiBase), {
        headers: { accept: "application/json", "x-ds-project": projectSlug },
      });
      if (!response.ok) return;

      for (const [name, value] of brandingCssVariables(
        parseBranding(await response.json()),
      )) {
        // `setProperty`, never a built-up stylesheet string: this API takes a
        // name and a value and cannot be talked into a third declaration.
        mount.style.setProperty(name, value);
      }
    } catch {
      // Network failure, blocked request, malformed JSON — the defaults stand.
    }
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

  /**
   * Re-apply a property the host page set before this element upgraded.
   *
   * An own data property set on a not-yet-upgraded element shadows the
   * prototype's accessor forever. Deleting it and reassigning routes the value
   * through the setter, which is where it should have gone. This is the
   * standard custom-element upgrade dance, and it exists because element
   * definition is asynchronous while the page's scripts are not.
   */
  #upgradeProperty(name: "tokenProvider"): void {
    if (!Object.prototype.hasOwnProperty.call(this, name)) return;
    const value = this[name];
    // The property being removed is the *own data property* the host page
    // created before upgrade, not the prototype accessor declared above.
    // TypeScript has no way to express that distinction, and `delete` on a
    // non-optional member is an error — hence the widened view.
    delete (this as Partial<DsLmsElement>)[name];
    this[name] = value;
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
