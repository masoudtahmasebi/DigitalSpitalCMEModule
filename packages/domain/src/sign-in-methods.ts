/**
 * Which sign-in entry points a project offers, and what each one may reach
 * (P213-01).
 *
 * This file exists because the two questions look independent and are not. A
 * DocCheck login proves somebody is a healthcare professional; it does **not**
 * identify a physician to the accreditation chain, so it yields no platform
 * token and no user id. Everything a CME point depends on — an enrolment, a
 * watch record, a Lernerfolgskontrolle, an EFN, a Punktemeldung, a certificate
 * — needs that identity. So the honest model is not "two logins" but "one
 * login, plus a reading room", and the rules below are what keep the reading
 * room from quietly becoming a second way in.
 *
 * Without it, each caller would decide for itself what a DocCheck visitor may
 * do, and the widget's answer, the API's answer and the console's description
 * of the setting would drift apart — which on this platform is a compliance
 * problem rather than an inconsistency (§9.10b).
 *
 * Pure: no I/O, no clock, no framework (CLAUDE.md §4 invariant 4).
 */

/** What a project permits. Both are stored columns — migration 0055. */
export interface SignInMethods {
  /**
   * The DocCheck entry point — and, because it yields no platform token, also
   * what permits a tokenless visitor to read this project's catalogue.
   */
  readonly docCheckLoginAllowed: boolean;
  /** The Keycloak entry point — the only one that produces a platform token. */
  readonly keycloakLoginAllowed: boolean;
}

/**
 * Why a pair of settings cannot be stored, or `undefined` when it can.
 *
 * One case today, and it is a real one rather than defensive tidiness: a
 * project with neither method permitted renders a screen with no way forward,
 * which is §9.2 — an affordance the system will refuse. It is returned as a
 * code so the API can turn it into a problem-details reason and the console can
 * turn it into German without either of them restating the rule.
 */
export type SignInMethodsProblem = "no_method_permitted";

export function signInMethodsProblem(
  methods: SignInMethods,
): SignInMethodsProblem | undefined {
  if (!methods.docCheckLoginAllowed && !methods.keycloakLoginAllowed) {
    return "no_method_permitted";
  }
  return undefined;
}

/*
 * There was an `anonymousAccess(methods)` here, returning "preview" or
 * "nothing", and it is deliberately gone (P213-01).
 *
 * Nothing called it, and nothing should have: the decision it restated is
 * `resolve_catalogue_preview`'s predicate in migration 0055, evaluated in SQL
 * by a SECURITY DEFINER function, because that is where a disclosure gate for
 * an unauthenticated caller belongs. A TypeScript copy of it would have been a
 * second home for one fact (§9.10b) — the very thing the two columns were kept
 * from becoming — and it would have been the copy somebody edited.
 *
 * It survived long enough to be written, exported and exhaustively tested,
 * which is §9.3's shape exactly. What found it was `scripts/unused-rules.mjs`
 * **after** being repaired: its export parser could see only multi-line export
 * blocks, so the 41 single-line ones in `index.ts` — including this file's —
 * had never been scanned at all.
 */
