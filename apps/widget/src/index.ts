/**
 * `<ds-lms>` entry point (P5-01).
 *
 * Registering on import is what lets a WordPress plugin ship one
 * `<script type="module" src="ds-lms.js">` and then place the tag anywhere on
 * the page — including in markup that was already parsed, since custom
 * elements upgrade retroactively.
 */

import { registerWidget } from "./element.js";

export { DsLmsElement, WIDGET_ELEMENT_NAME, registerWidget } from "./element.js";
export type { TokenProvider, TokenRequest } from "./token.js";

registerWidget();
