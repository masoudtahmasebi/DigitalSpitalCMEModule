/**
 * English for the console (P86-01).
 *
 * ## Deliberately partial
 *
 * A **deep-partial** of the German table, merged over it by `overlay`. Anything
 * absent renders in German, which is legible to the operators this console is
 * for — the alternative to a partial table is either a thousand strings
 * invented in one sitting or a screen full of key names.
 *
 * Filling it in is additive: each entry is one more sentence that switches
 * over, nothing else moves, and no component changes.
 *
 * ## What is intentionally left in German
 *
 * The accreditation vocabulary. _Zertifizierung_, _Lernerfolgskontrolle_,
 * _Teilnahmebescheinigung_, _Fortbildung_, _EFN_, _VNR_ are the terms the
 * Ärztekammer, the Anerkennungsbescheid and MEDICE's own documents use, and
 * they are what an operator will be reading on the paperwork beside the screen.
 * "Learning assessment" is a translation of `Lernerfolgskontrolle` and is not
 * the name of the thing; guessing an English equivalent for a term that appears
 * on a legal document is exactly the guess CLAUDE.md §7 refuses.
 *
 * Where a German term is genuinely a product noun rather than a legal one, it
 * is translated. Where it is both, it is kept.
 *
 * ## What is translated first
 *
 * Navigation, the actions on every screen, and the failure messages — the
 * strings an English-speaking operator meets in the first minute and needs most
 * when something has gone wrong.
 */

import type { german } from "./de.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends object
      ? DeepPartial<T[K]>
      : never;
};

export const en: DeepPartial<typeof german> = {
  language: {},

  nav: {
    security: "Security",
    courses: "Courses",
    participants: "Participants",
    branding: "Appearance",
    organisation: "Organisation",
    back: "Back",
    groupCatalogue: "Catalogue",
    groupPeople: "Participation",
    groupPlatform: "Settings",
    menu: "Menu",
    closeMenu: "Close menu",
  },

  loading: "Loading …",

  error: {
    title: "Something went wrong",
    retry: "Try again",
    generic: "Please try again later.",
  },

  copy: {
    nav: "Wording",
    intro:
      "Change the labels and sentences participants see in a course. Leave a field empty to use the default. Changes apply to the selected project.",
    project: "Project",
    filter: "Search",
    save: "Save wording",
    saving: "Saving …",
    saved: "Saved.",
    fixed: "Not editable",
    fixedHint:
      "This sentence contains a number and is built in code so that singular and plural are both correct (“1 Punkt” against “4 Punkten”). As a free-text template the singular would be lost.",
  },

  media: {
    title: "Media library",
    open: "Choose from library",
    close: "Close",
    intro:
      "Every file uploaded for this customer. Pick one instead of uploading the same file again.",
    empty:
      "No file has been uploaded for this customer yet. Once you upload something it appears here and can be used in other courses.",
    unknownType: "File type unknown",
    assetTitle: "Title",
    assetAlt: "Alternative text",
    altHint:
      "The title names the file for you in this list. The alternative text describes the image for people who cannot see it — screen readers read it out, and it is required for accessibility (WCAG 1.1.1). Left empty, it counts as not set.",
    use: "Use this file",
    forget: "Remove from library",
    forgetHint:
      "Removing only deletes the entry from this list — the file itself stays in storage. While a course still uses the file, removing it is refused.",
  },
};
