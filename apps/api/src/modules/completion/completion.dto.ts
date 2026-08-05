/**
 * Evaluation, EFN and completion DTOs (P6, P1-06, P7).
 *
 * The EFN appears in exactly one direction: inbound, in `efnInputSchema`.
 * Nothing here can carry it back out (ADR-0004) — the enrolment state reports
 * only `efnPresent: boolean`.
 */

import { z } from "zod";

export const evaluationQuestionSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  kind: z.enum(["scale", "single", "multi", "text"]),
  prompt: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
});

export const evaluationSchema = z.object({
  courseSlug: z.string(),
  submitted: z.boolean(),
  questions: z.array(evaluationQuestionSchema),
});

/**
 * A single answer: a scale value, a chosen option or options, or free text.
 *
 * Free text is personal data under ADR-0004 and is bounded here rather than
 * left open — an unbounded text column is both a storage and a disclosure
 * risk, and no legitimate evaluation answer needs more.
 */
export const evaluationAnswerValueSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.array(z.string().max(500)).max(50),
]);

export const evaluationSubmissionSchema = z.object({
  answers: z
    .array(
      z.object({
        evaluationId: z.uuid(),
        answer: evaluationAnswerValueSchema,
      }),
    )
    .max(100),
});

/**
 * The Punktemeldung form (layout page 13).
 *
 * ## Why this is one request and not three
 *
 * The layout draws one screen with `Titel`, `Vorname`, `Nachname`, `EFN-Nummer`
 * and a consent checkbox, and one button: **Daten übermitteln**. Splitting that
 * into "save the EFN", "save the name" and "complete" would give a physician
 * three ways to end up half-submitted — an EFN stored against a course that was
 * never completed, or a completion queued before the consent that authorises it.
 * The four things arrive together because they are one decision.
 *
 * `PUT /courses/{slug}/efn` still exists, for correcting an EFN before the
 * submission window closes (S4). It is not this.
 *
 * ## The name
 *
 * Three parts, exactly as the layout captures them. What gets printed on the
 * Teilnahmebescheinigung and reported to the Kammer is one string, composed by
 * `composeAttestedName` in `@ds/domain` — see the note there for why there is
 * one composer and not two.
 *
 * The parts are optional as a group: a host that is not this widget may still
 * complete a course and fall back to the profile name. Supplying a given name
 * without a family name is refused rather than half-accepted.
 *
 * ## The consent
 *
 * `consentDocument` names the privacy notice version the learner agreed to. It
 * is required whenever the request would trigger a Punktemeldung, because GDPR
 * Art. 7(1) puts the burden of demonstrating consent on the controller and a
 * boolean records only that somebody agreed to something.
 */
const namePart = z.string().trim().min(1).max(100);

export const completionInputSchema = z
  .object({
    /** "Dr. med.", "Prof. Dr." — the layout's `Titel` select. */
    attestedTitle: namePart.optional(),
    attestedGivenName: namePart.optional(),
    attestedFamilyName: namePart.optional(),
    /**
     * 15 digits — see `efnInputSchema`. Optional here because a learner may
     * have supplied it earlier through the correction endpoint.
     */
    efn: z
      .string()
      .regex(/^[0-9]{15}$/)
      .optional(),
    /**
     * The privacy notice the consent checkbox referred to, by version.
     * Free-form so the wording can be versioned however the DPO prefers;
     * bounded because it is written to a column, not to a log.
     */
    consentDocument: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (input) =>
      (input.attestedGivenName === undefined) ===
      (input.attestedFamilyName === undefined),
    {
      message: "Vorname and Nachname are supplied together or not at all",
      path: ["attestedGivenName"],
    },
  )
  .refine(
    (input) => input.attestedTitle === undefined || input.attestedGivenName !== undefined,
    { message: "a title alone is not a name", path: ["attestedTitle"] },
  );

export const efnInputSchema = z.object({
  /**
   * 15 digits. Validated again by `isValidEfn` in `@ds/domain` before storage —
   * this schema rejects the obviously malformed, the domain owns the rule.
   *
   * **The layout says 18.** Page 13's helper text reads "Die 18-stellige EFN"
   * and its placeholder is eighteen characters. Nothing has been changed here:
   * see S21 in `docs/show-stoppers.md`. A validator that is wrong in either
   * direction fails where the learner cannot see it.
   */
  efn: z.string().regex(/^[0-9]{15}$/),
});

export type Evaluation = z.infer<typeof evaluationSchema>;
export type EvaluationSubmission = z.infer<typeof evaluationSubmissionSchema>;
export type EfnInput = z.infer<typeof efnInputSchema>;
export type CompletionInput = z.infer<typeof completionInputSchema>;
