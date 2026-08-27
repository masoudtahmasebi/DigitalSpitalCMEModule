/**
 * The Zertifizierung tab (layout page 04) — #60.
 *
 * ## What this tab stopped being
 *
 * It was the course's module outline, plus the EFN field, plus **Fortbildung
 * abschließen**. The layout puts none of that here: page 04 is five prose
 * sections telling a physician what the accreditation is, what they must do to
 * earn it, how the points are reported, and what the certificate will contain.
 * The form belongs on page 13, behind the quiz-passed screen's **CME-Punkte
 * geltend machen**, and that is where it now is.
 *
 * The difference is not cosmetic. A learner opened this tab to read about the
 * accreditation and met a form asking for their EFN — a number the platform then
 * has no reason to hold until they have actually finished. Asking for an
 * identifier before the event that justifies collecting it is the shape of
 * problem `docs/gdpr.md` exists to keep this platform out of.
 *
 * ## Every number is the course's own
 *
 * `requiredWatchPercent` and `passThresholdPercent` are rendered from the
 * course, never written into the German. This tab states the *accreditation
 * conditions*; a sentence promising 80 % over a course configured at 70 would
 * be the platform telling a physician the wrong rule about their own CME points.
 *
 * `minimumCorrectAnswers` is not computed here for the same reason — see its
 * header in `@ds/domain`.
 *
 * ## A course with no accreditation
 *
 * Supported, not broken: the client asked for courses without points and
 * `ds-ohne-punkte` exists to exercise it. Such a course gets one sentence saying
 * so, rather than a Zertifizierung panel with every value blank.
 */

import { formatBerlinDate } from "@ds/domain";
import type { CourseDetail } from "@ds/sdk";
import { de } from "../locale/de.js";
import { CheckBullet, Section } from "./primitives.js";

/** The rule between sections, as on the Übersicht tab. */
const DIVIDED = "border-t border-gray-200 pt-8 first:border-t-0 first:pt-0";

export function CertificationTab(props: {
  course: CourseDetail;
  /** The download, once there is one. Absent until the course is complete. */
  certificate: React.ReactNode;
}) {
  const { course } = props;

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-bold text-gray-900">{de.certification.title}</h2>

      {course.cmePoints === null ? (
        <p className="text-sm leading-relaxed text-gray-800">
          {de.certification.noPoints}
        </p>
      ) : (
        <>
          <Section title={de.certification.points} className={DIVIDED}>
            <p className="text-sm leading-relaxed text-gray-800">
              {de.certification.pointsSentence(course.cmePoints)}
            </p>
          </Section>

          {course.accreditationBody === null ? null : (
            <Section title={de.certification.accreditation} className={DIVIDED}>
              <p className="text-sm leading-relaxed text-gray-800">
                {de.certification.accreditedBy(
                  course.accreditationBody,
                  course.cmePoints,
                )}
              </p>

              {/* Both dates or neither: "Gültigkeit: 01.01.2026 – " is worse
                  than no validity line at all, and an accreditation with only
                  one end recorded is an authoring gap, not a fact to print. */}
              {course.validFrom === null || course.validTo === null ? null : (
                <p className="text-sm text-gray-800">
                  {de.certification.validity(
                    formatBerlinDate(new Date(course.validFrom)),
                    formatBerlinDate(new Date(course.validTo)),
                  )}
                </p>
              )}

              {/*
                The Fortbildungsnummer *is* the VNR (S31, answered by MEDICE on
                27.08.2026).

                The layout draws a line labelled "Fortbildungsnummer" and the
                platform carried a separate `fortbildungsnummer` column to fill
                it — editable in the console, NULL on every real course, and
                read by nothing else. Two writable fields for one number is an
                operator entering one thing here and another in `vnr`, after
                which the screen shows one number and the Punktemeldung reports
                the other. The label is the layout's and stays (§5); the value
                is now the one that is actually reported.
              */}
              {course.vnr === null ? null : (
                <p className="text-sm text-gray-800">
                  {de.certification.fortbildungsnummer(course.vnr)}
                </p>
              )}
            </Section>
          )}

          <Section title={de.certification.requirements} className={DIVIDED}>
            <p className="text-sm text-gray-800">{de.certification.requirementsLead}</p>
            <ul className="space-y-3">
              {[
                de.certification.requirementWatch(course.requiredWatchPercent),
                de.certification.requirementQuiz(course.passThresholdPercent),
                de.certification.requirementEvaluation,
              ].map((requirement) => (
                <li key={requirement} className="flex gap-3 text-sm text-gray-800">
                  <CheckBullet />
                  <span>{requirement}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={de.certification.reporting} className={DIVIDED}>
            <p className="text-sm leading-relaxed text-gray-800">
              {de.certification.reportingBody}
            </p>
            <p className="text-sm leading-relaxed text-gray-800">
              {de.certification.reportingEfn}
            </p>
          </Section>
        </>
      )}

      <Section title={de.certification.certificate} className={DIVIDED}>
        <p className="text-sm leading-relaxed text-gray-800">
          {de.certification.certificateLead}
        </p>
        <ul className="space-y-1 text-sm font-bold text-gray-900">
          {de.certification.certificateContents.map((entry) => (
            <li key={entry} className="flex gap-2">
              <span aria-hidden="true">·</span>
              <span>{entry}</span>
            </li>
          ))}
        </ul>

        {/* The one action on the tab, and it is a download rather than a form.
            The layout describes the certificate here, so this is where a
            learner who has earned one comes looking for it. */}
        {props.certificate}
      </Section>
    </div>
  );
}
