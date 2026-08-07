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
 *
 * ## The one event the widget emits
 *
 * With no `course` attribute the widget opens the catalogue and handles the
 * pick itself, which is what a WordPress page wants: one embed, no routing.
 * A host that *does* route — the portal gives each course its own URL so a
 * learner can bookmark one — needs to know when a course was chosen, and needs
 * the widget not to navigate underneath it.
 *
 * So picking a course dispatches a **cancelable** `ds-lms:course-open` carrying
 * `{ slug }`. Calling `preventDefault()` means "the host is handling this", and
 * the widget stays where it is. A host that does not listen gets the old
 * behaviour unchanged, which is why this is one event rather than a mode flag:
 * there is no configuration to get wrong, and no second code path for the
 * WordPress case.
 *
 * `composed: true` is *not* about this element's own shadow root — the event is
 * dispatched on the host element, which is in the light DOM, so it escapes
 * either way. It is for the host that puts `<ds-lms>` inside a shadow root of
 * its own: a block theme, or another web component. Without `composed` the
 * event would stop at *that* boundary and the host would silently never route.
 */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
// The built Tailwind output, as a string — see vite.config.ts.
import styles from "./styles.css?inline";
import { brandingCssVariables, fontFaceRule, parseBranding } from "@ds/domain";
import { App } from "./App.js";
import { cachingProvider, resolveTokenProvider, type TokenProvider } from "./token.js";

export const WIDGET_ELEMENT_NAME = "ds-lms";

/** Dispatched when a learner picks a course in the catalogue. See the header. */
export const COURSE_OPEN_EVENT = "ds-lms:course-open";

/**
 * Dispatched when the server has recorded watch progress.
 *
 * Not on every `timeupdate`: this fires on a **confirmed** report, so the
 * figures in it are the ones the CME gate will use. A host wiring analytics to
 * a client-side estimate would be measuring something the platform does not
 * credit.
 */
export const PROGRESS_EVENT = "ds-lms:progress";

/** Dispatched once, when the server marks the course complete. */
export const COURSE_COMPLETE_EVENT = "ds-lms:course-complete";

export interface CourseOpenDetail {
  readonly slug: string;
  /**
   * Which of the catalogue's two buttons was pressed.
   *
   * `"start"` is **Zur Fortbildung** — the course's start page. `"resume"` is
   * **Fortbildung fortsetzen** — straight into the content the learner left
   * off at. A routing host that ignores this lands both on the start page,
   * which is the old behaviour and is not wrong, only less helpful; a host
   * that honours it should mount the element with `open-at="resume"`.
   */
  readonly intent: "start" | "resume";
}

export interface ProgressDetail {
  readonly courseSlug: string;
  /** Union watch coverage across the whole course, 0–100. */
  readonly watchedPercent: number;
  /** Required coverage for this enrolment, 0–100. */
  readonly requiredWatchPercent: number;
  /** Content items finished over content items in the course, 0–100. */
  readonly coursePercent: number;
  readonly modulesCompleted: number;
  readonly modulesTotal: number;
  /** What the learner still owes: watch, quiz, evaluation, efn. */
  readonly outstanding: readonly string[];
  readonly complete: boolean;
}

export interface CourseCompleteDetail {
  readonly courseSlug: string;
  readonly completedAt: string;
}

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

  /**
   * Assigning after the element has connected re-renders it.
   *
   * `#upgradeProperty` covers a provider set *before* upgrade — the WordPress
   * plugin's case, where an inline script runs ahead of the deferred module.
   * It does not cover the opposite order, and that order is the normal one for
   * a React host: `connectedCallback` fires the instant the node is inserted,
   * and a `ref` callback runs *after* the commit. The element therefore read
   * `undefined`, decided the embed was misconfigured, and rendered
   *
   *     Diese Fortbildung ist nicht korrekt eingebunden.
   *
   * inside a **closed** shadow root — invisible to `innerText`, invisible in a
   * screenshot at a glance, and accompanied by no failed request to notice,
   * because a widget that has decided it is misconfigured never calls the API.
   * That is how `/medice` came to show a signed-in header above nothing at all.
   *
   * Re-rendering rather than throwing: a host may legitimately swap providers,
   * and React does exactly that whenever the memoised one changes identity.
   */
  set tokenProvider(value: TokenProvider | undefined) {
    if (this.#tokenProvider === value) return;
    this.#tokenProvider = value;
    if (this.#root !== undefined) this.#render();
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

    const apiBase = this.getAttribute("api-base") ?? "";
    const projectSlug = this.getAttribute("project") ?? "";

    // Applied to the wrapper as soon as it arrives, independently of React.
    // Branding must reach the loading and error states too, and those render
    // before — or instead of — anything the token can fetch.
    void this.#applyBranding(mount, apiBase, projectSlug);

    this.#root = createRoot(mount);
    this.#render();
  }

  /**
   * Build the tree and hand it to React.
   *
   * One implementation, called from `connectedCallback` and from the
   * `tokenProvider` setter. Two copies would eventually differ in exactly the
   * property that made the second one necessary.
   */
  #render(): void {
    const root = this.#root;
    if (root === undefined) return;

    const provider = resolveTokenProvider({
      provider: this.tokenProvider,
      endpoint: this.getAttribute("token-endpoint") ?? undefined,
    });

    const apiBase = this.getAttribute("api-base") ?? "";
    const projectSlug = this.getAttribute("project") ?? "";

    root.render(
      createElement(App, {
        apiBase,
        projectSlug,
        courseSlug: this.getAttribute("course") ?? "",
        // `open-at="resume"` puts a course-pinned element straight into the
        // content the learner left off at, which is how a routing host honours
        // the catalogue's **Fortbildung fortsetzen** across its own navigation.
        // Anything else — including the attribute being absent — is "start",
        // because opening a video the learner did not ask for is the worse
        // failure of the two.
        openAt: this.getAttribute("open-at") === "resume" ? "resume" : "start",
        getToken: provider === undefined ? undefined : cachingProvider(provider),
        onCourseOpen: (slug: string, intent: "start" | "resume") =>
          this.#announceCourseOpen(slug, intent),
        onProgress: (detail: ProgressDetail) => this.#announce(PROGRESS_EVENT, detail),
        onCourseComplete: (detail: CourseCompleteDetail) =>
          this.#announce(COURSE_COMPLETE_EVENT, detail),
      }),
    );
  }

  /**
   * Tell the host page a course was picked, and report whether it took over.
   *
   * `dispatchEvent` returns `false` when a listener called `preventDefault()`,
   * which is the host saying it is routing to that course itself. In that case
   * the widget must not also navigate: the host is about to replace this
   * element, and a widget that had already switched screens would flash the
   * course twice.
   */
  /**
   * Tell the host page something happened, without asking its permission.
   *
   * Not cancelable, unlike `ds-lms:course-open`: these are notifications about
   * a decision the **server** has already made and written down. A host that
   * called `preventDefault()` on a completion would be cancelling nothing —
   * the CME point is recorded either way — so offering the handle would be
   * offering a lie.
   */
  #announce(name: string, detail: unknown): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, cancelable: false, composed: true }),
    );
  }

  #announceCourseOpen(slug: string, intent: "start" | "resume"): boolean {
    const detail: CourseOpenDetail = { slug, intent };
    return this.dispatchEvent(
      new CustomEvent(COURSE_OPEN_EVENT, {
        detail,
        bubbles: true,
        cancelable: true,
        // For a host that mounts `<ds-lms>` inside its own shadow root — see
        // the note in the file header. Verified by probe: this element's own
        // (closed) root is not what needs it.
        composed: true,
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

      const branding = parseBranding(await response.json());

      for (const [name, value] of brandingCssVariables(branding)) {
        // `setProperty`, never a built-up stylesheet string: this API takes a
        // name and a value and cannot be talked into a third declaration.
        mount.style.setProperty(name, value);
      }

      if (branding.fontFamilyName !== undefined && branding.fontVersion !== undefined) {
        declareFont(apiBase, projectSlug, branding.fontFamilyName, branding.fontVersion);
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
 * Declare the customer's uploaded font — in the **document**, not the shadow
 * root (P10-08).
 *
 * ## Why not in the shadow root, where the rest of the CSS lives
 *
 * Chrome does not apply `@font-face` rules declared inside a shadow root. The
 * rule parses, the font never loads, and the fallback stack renders — which
 * looks exactly like a broken upload rather than like a scoping rule, and would
 * be diagnosed as such. Only the `@font-face` declaration escapes; every
 * `font-family` reference stays inside the widget, so this adds no style the
 * host page can see. A host page that already declares a font of the same name
 * is the customer's own site declaring their own typeface.
 *
 * ## Why the URL carries the project as a query parameter
 *
 * The browser fetches this file from CSS, where no custom header can be
 * attached. `GET /branding/font` accepts `?project=` for that reason alone.
 *
 * Idempotent by construction: several `<ds-lms>` elements on one page, or a
 * page that mounts the widget twice, produce one `<style>` element per
 * font version. Keyed on the version too, so replacing a font in the admin
 * console takes effect on the next load rather than being masked by the first
 * declaration to win.
 */
function declareFont(
  apiBase: string,
  projectSlug: string,
  familyName: string,
  version: string,
): void {
  const id = `ds-lms-font-${projectSlug}-${version}`;
  if (document.getElementById(id) !== null) return;

  const url = new URL("/branding/font", apiBase);
  url.searchParams.set("project", projectSlug);
  url.searchParams.set("v", version);

  // Built and validated in `@ds/domain`. `undefined` means a value failed its
  // grammar at the point of concatenation, and an unstyled widget is the right
  // outcome for that.
  const rule = fontFaceRule(familyName, url.toString());
  if (rule === undefined) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = rule;
  document.head.append(style);
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
