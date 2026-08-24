/**
 * Query validation for the Punktemeldung queue (P110-01).
 *
 * A file of its own rather than a schema inlined in the controller, because the
 * status list has to stay identical to the `eiv_status` enum and to the
 * contract's, and three copies drifting apart is how a screen ends up unable to
 * filter to a state the database can hold.
 *
 * `z.coerce` on the numbers because query parameters arrive as strings; the
 * ceiling on `perPage` is the contract's, so a caller cannot ask for the whole
 * table in one response.
 */

import { z } from "zod";

/** Exactly `eiv_status`. See `EivSubmissionStatus` in the repository. */
export const eivSubmissionStatus = z.enum([
  "queued",
  "held",
  "submitted",
  "failed_retryable",
  "failed_permanent",
  "window_closed",
  "withdrawn",
]);

export const listEivSubmissionsQuerySchema = z.object({
  status: eivSubmissionStatus.optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(25),
});

export type ListEivSubmissionsQuery = z.infer<typeof listEivSubmissionsQuerySchema>;
