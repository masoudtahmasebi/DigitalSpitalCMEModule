/**
 * Where the console's destinations are declared, and the only place they are.
 *
 * ## Why this is a file rather than a constant in `App.tsx`
 *
 * It was a constant in `App.tsx`, in the middle of 1,929 lines that also held
 * the shell, the router, the view union and most screen composition. Three
 * things followed from that and none of them were visible while it was one
 * file:
 *
 * - **`pnpm check:roles` parses this table.** A gate that reads a literal out
 *   of a file that size is a gate that breaks when somebody reformats the file
 *   around it — and §9.2's whole point is that this table is what stops a role
 *   being offered a screen the API will refuse.
 * - **Nothing could test the navigation without rendering the console.** The
 *   question "which sections does a `course_editor` see?" is a pure function of
 *   this table and a capability list, and answering it needed a signed-in
 *   console with an API.
 * - **A redesign of the sidebar had to be a diff against the router.**
 *
 * The table below is moved verbatim. Nothing about which role sees which screen
 * changes in this commit, which is what makes it reviewable.
 *
 * ## What belongs here and what does not
 *
 * A destination's **identity** — its kind, its label, the page chrome it draws,
 * and the capability that decides whether it is drawn at all. Not its content,
 * not its data, and not its component: a screen that needed its component named
 * here would make this file import every screen in the console, which is the
 * dependency shape that made `App.tsx` 1,929 lines in the first place.
 */

import { de } from "../../locale/de.js";
import type { Route } from "../../routes.js";

/**
 * The sections, and the capability each one needs.
 *
 * `undefined` means every operator. `customer` is held only by `super_admin`
 * (P12-01b) — a customer is the tenant boundary itself, so nobody inside one
 * may see or mint another.
 *
 * This hides a tab; it does not protect anything. The API 403s the endpoints
 * behind it regardless of what was drawn, and `Customers` handles that 403
 * because a URL can be typed.
 */
export interface Section {
  readonly kind: Route["kind"];
  /** Short, for the sidebar. */
  readonly label: string;
  /**
   * The page heading and the sentence under it.
   *
   * Declared here rather than inside each screen — react-admin's `Resource`
   * idea: the page chrome belongs to the destination, not to the component
   * that happens to fill it. Ten screens each drawing their own heading is how
   * three of them ended up with none and two with a heading in a different
   * size.
   */
  readonly title: string;
  readonly description?: string;
  /** `undefined` means every operator may see it. */
  readonly capability?: string;
}

export interface NavGroup {
  readonly heading: string;
  readonly sections: readonly Section[];
}

/**
 * The navigation, grouped by the question each part answers (P30-02).
 *
 * Ten flat destinations is a list an operator re-reads top to bottom every
 * time, because nothing says which part of it they are in. Grouped, the shape
 * of the console is legible at a glance and matches the order somebody actually
 * works in:
 *
 *   **Angebot** — what exists to be taken. A customer, its departments and
 *   projects, and the courses inside them. Setup flows downwards through it.
 *   **Teilnahme** — who is taking it, how far they have got, and what came out
 *   at the end. Access first: an account has to exist before it can have
 *   progress, and this is the screen that creates one.
 *   **Einstellungen** — the platform itself. Visited once, then rarely.
 *
 * Capability decides only what is *drawn*. The API 403s every endpoint behind a
 * hidden screen regardless, because any of them can be reached by typing a URL
 * — `Customers` handles that 403 for exactly that reason.
 */
export const NAV: readonly NavGroup[] = [
  {
    heading: de.nav.groupCatalogue,
    sections: [
      // A customer is the tenant boundary itself, so only `super_admin` holds
      // `customer` — nobody inside one may see or mint another (P12-01b).
      {
        kind: "customers",
        label: de.customers.title,
        title: de.customers.title,
        description: de.customers.intro,
        capability: "customer",
      },
      /*
       * Plattform → Punktemeldung (P180-01).
       *
       * `platform`, which only `super_admin` holds. There is one EIV worker per
       * installation and one register it talks to; a customer administrator's
       * authority is over their own courses and participants, and pointing the
       * platform at the live Ärztekammer endpoint would file statutory reports
       * for every tenant at once — including ones they have never heard of.
       *
       * Beside Kunden because both are about the installation rather than about
       * a course, and both are drawn for exactly one role.
       */
      {
        kind: "platform-eiv",
        label: de.platform.nav,
        title: de.platform.title,
        description: de.platform.intro,
        capability: "platform",
      },
      /*
       * `project`, which a course editor does not hold (P38-01).
       *
       * This screen reads departments and projects, and both reads 403 for
       * them — so leaving it undrawn is not a courtesy here, it is the
       * difference between a menu entry and a menu entry that can only produce
       * an error. `department_admin` does hold `project`, and their writes are
       * refused by the API as they always were.
       */
      {
        kind: "organisation",
        label: de.nav.organisation,
        title: de.organisation.title,
        description: de.organisation.intro,
        capability: "project",
      },
      {
        kind: "courses",
        label: de.nav.courses,
        title: de.courses.title,
        // The screen an operator opens first, and the only one that had no
        // description at all (P136-01).
        description: de.courses.intro,
      },
      /*
       * The Mediathek (P88-01), under ANGEBOT beside the courses whose files it
       * holds — it is content, not a setting.
       *
       * `project`, the same capability as Erscheinungsbild and Texte. The
       * library spans every course of the customer, so it is not a course
       * editor's own material: a `course_editor` writes the courses they are
       * given and does not tidy the shared shelf. Their uploads still land in
       * it and the picker still offers it to them, which is the reuse this was
       * built for.
       */
      {
        kind: "media",
        label: de.media.nav,
        title: de.media.title,
        description: de.media.screenIntro,
        capability: "project",
      },
    ],
  },
  {
    heading: de.nav.groupPeople,
    sections: [
      {
        kind: "participants",
        label: de.participantAccounts.title,
        title: de.participantAccounts.title,
        description: de.participantAccounts.intro,
        capability: "learner_record",
      },
      // Learner records and certificates need `learner_record` / `certificate`,
      // which a department admin and a course editor do not hold: neither has
      // business correcting a physician's name or withdrawing a document.
      {
        kind: "learners",
        label: de.learners.title,
        title: de.learners.title,
        description: de.learners.intro,
        capability: "learner_record",
      },
      {
        kind: "certificates",
        label: de.certificates.title,
        title: de.certificates.title,
        description: de.certificates.intro,
        capability: "certificate",
      },
      /*
       * The Punktemeldung queue (P110-01), beside the certificates it produces
       * — they are two halves of one completion, and an operator looking at a
       * physician's certificate is one row away from the point it reports.
       *
       * `certificate`, the same capability: this row is about one person's CME
       * record, which is exactly what that capability governs. A weaker one
       * would put a masked EFN and a statutory deadline in front of somebody
       * the platform does not trust with the certificate itself.
       */
      {
        kind: "punktemeldungen",
        label: de.eivQueue.nav,
        title: de.eivQueue.title,
        description: de.eivQueue.screenIntro,
        capability: "certificate",
      },
    ],
  },
  {
    heading: de.nav.groupPlatform,
    sections: [
      {
        kind: "staff",
        label: de.staff.title,
        title: de.staff.title,
        description: de.staff.intro,
        capability: "staff_user",
      },
      /*
       * `project` as well (P38-01). Branding is a project's typeface, colours
       * and catalogue copy; a course editor writes courses, not the surface
       * they appear on, and `GET /admin/branding/font` refuses them.
       */
      {
        kind: "branding",
        label: de.nav.branding,
        title: de.nav.branding,
        description: de.branding.intro,
        capability: "project",
      },
      /*
       * Texte (P83-04), beside Erscheinungsbild and with the same capability.
       * Both are "how this project looks and reads to a learner", and a course
       * editor writes courses rather than the surface they appear on.
       */
      {
        kind: "copy",
        label: de.copy.nav,
        title: de.copy.nav,
        description: de.copy.intro,
        capability: "project",
      },
      // No capability: every operator may read the rules their own sign-in is
      // subject to. Which of them they may *change* is enforced on the write —
      // hiding the screen would only hide the platform row from the people it
      // governs (P22-02).
      {
        kind: "security",
        label: de.nav.security,
        title: de.security.title,
        description: de.security.intro,
      },
    ],
  },
];

/**
 * The sections an operator may actually see.
 *
 * Pure, and separately callable, which is the point: "what does a
 * `department_admin` get?" was previously only answerable by rendering the
 * console against an API. A group whose every destination is hidden is dropped
 * entirely — a heading floating over nothing is what a `course_editor` used to
 * get over *Teilnahme* (§9.2 in its mildest form: a label that promises
 * somewhere to go and leads nowhere).
 */
export function visibleNav(
  capabilities: readonly string[],
  groups: readonly NavGroup[] = NAV,
): readonly NavGroup[] {
  return groups
    .map((group) => ({
      heading: group.heading,
      sections: group.sections.filter(
        (section) =>
          section.capability === undefined || capabilities.includes(section.capability),
      ),
    }))
    .filter((group) => group.sections.length > 0);
}

/**
 * The section a view belongs to, for its page chrome.
 *
 * `undefined` for the screens that are not navigation destinations — the course
 * workspace and the new-course form — which draw their own `Page`.
 */
export function sectionFor(
  kind: Route["kind"],
  groups: readonly NavGroup[] = NAV,
): Section | undefined {
  return groups
    .flatMap((group) => group.sections)
    .find((section) => section.kind === kind);
}
