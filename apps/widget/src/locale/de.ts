/**
 * Where the widget's German copy lives (CLAUDE.md §5).
 *
 * The table itself moved to `@ds/copy` in P83-01, because the API and the
 * admin console now need the same list — the API to refuse an override naming
 * a key that no longer exists, the console to draw a field per key. That
 * package's header records the reasoning.
 *
 * This file stays, and stays the import every component uses, so the rule a
 * component author follows is unchanged: nothing user-facing is written inline
 * in a component, and `de` is where it comes from.
 */

export { de } from "@ds/copy";
