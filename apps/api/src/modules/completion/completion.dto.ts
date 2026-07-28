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
 * The completion request body.
 *
 * `attestedName` is the name the learner confirms should appear on the
 * Teilnahmebescheinigung and in the Punktemeldung. It is optional: when it is
 * absent the Keycloak profile name is used. It exists because the Keycloak
 * profile may be stale or incomplete and the certificate carries a mandatory
 * "Name des Teilnehmenden" — see docs/requirements/medice-adhs.md §6.5. The
 * token remains the identity authority; this is only what gets printed.
 *
 * Bounded at 200 characters: a name, not a free-text field.
 */
export const completionInputSchema = z.object({
  attestedName: z.string().trim().min(1).max(200).optional(),
});

export const efnInputSchema = z.object({
  /**
   * 15 digits. Validated again by `isValidEfn` in `@ds/domain` before storage —
   * this schema rejects the obviously malformed, the domain owns the rule.
   */
  efn: z.string().regex(/^[0-9]{15}$/),
});

export type Evaluation = z.infer<typeof evaluationSchema>;
export type EvaluationSubmission = z.infer<typeof evaluationSubmissionSchema>;
export type EfnInput = z.infer<typeof efnInputSchema>;
export type CompletionInput = z.infer<typeof completionInputSchema>;
