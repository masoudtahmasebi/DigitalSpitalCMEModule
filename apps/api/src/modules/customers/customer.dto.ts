/**
 * Request and response shapes for the customer registry (P12-04).
 *
 * The slug rules are the same ones every other level of the hierarchy uses, and
 * are restated here rather than imported from `authoring.dto.ts` for one
 * reason: a customer slug is not an authoring concern. Departments, projects
 * and courses are things a customer's own administrator creates; a customer is
 * the tenant boundary, created only by a platform operator (P12-01b). Sharing
 * the module would put the one schema a customer administrator must never reach
 * in the same file as the ones they use constantly.
 *
 * `customerCreateSchema` did previously live in `authoring.dto.ts`, with no
 * endpoint and no reference anywhere — which is a fair summary of how complete
 * this level of the hierarchy was.
 */

import { z } from "zod";

/**
 * Deliberately not a general-purpose slug regex with nested quantifiers. See
 * the note in `authoring.dto.ts`: a flat character class plus two boundary
 * checks says the same thing with no backtracking behaviour to be surprised by.
 */
const SLUG_CHARACTERS = /^[a-z0-9-]{1,100}$/;

const slug = z
  .string()
  .trim()
  .regex(SLUG_CHARACTERS, "lowercase letters, digits and hyphens only, 1–100 characters")
  .refine(
    (value) => !value.startsWith("-") && !value.endsWith("-"),
    "must not start or end with a hyphen",
  );

const name = z.string().trim().min(1).max(200);

export const customerCreateSchema = z.object({ slug, name });

/**
 * The slug is absent on purpose.
 *
 * A customer's slug is the stable identifier the console, its own URLs and any
 * operational runbook refer to. Renaming is a display change; re-slugging is a
 * rename of the thing itself, and doing it silently through the same PATCH that
 * fixes a typo in a company name is how a link somebody bookmarked stops
 * working with nothing in the audit trail to explain it.
 */
export const customerUpdateSchema = z.object({ name });

export const customerSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  createdAt: z.string(),
  departmentCount: z.number().int(),
  projectCount: z.number().int(),
  courseCount: z.number().int(),
});

export type CustomerCreate = z.infer<typeof customerCreateSchema>;
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;
export type CustomerSummary = z.infer<typeof customerSummarySchema>;
