/**
 * Everything about a course that a physician can see (P13-01).
 *
 * The catalogue card, the course hero, the Übersicht tab: title, description,
 * Lernziele, Zielgruppe, the filter facets, the CME points badge, the
 * accreditation window.
 *
 * ## Why this is separate from `CourseSettings`
 *
 * That screen is about the Anerkennungsbescheid — a pass threshold that voids
 * an accreditation if it is wrong, a VNR password that authenticates us to the
 * Ärztekammer. This one is about words on a page. Putting them in one form
 * would mean an operator fixing a typo in a course title scrolls past a control
 * that can invalidate CME points, which is the wrong thing to make routine.
 *
 * ## Why the list fields are one textarea per line
 *
 * Lernziele, Thema and Altersgruppe are ordered lists of short strings. A
 * repeater with add/remove buttons is more chrome than the content deserves and
 * makes reordering a drag interaction; a textarea where a line is an item is
 * something anybody can paste into from the accreditation document they are
 * copying anyway. The order of the lines is the order the layout draws.
 *
 * ## What this form cannot do
 *
 * Change the slug. It is the course's identity in every URL, bookmark and
 * WordPress shortcode, and re-slugging through the form that fixes a typo in a
 * title would break them all silently.
 */

import { useEffect, useState } from "react";
import type { AdminCourseDetail, ApiClient } from "@ds/sdk";
import { datesOfWindow, windowFromDates } from "@ds/domain";
import { useUnsavedChanges } from "../hooks.js";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Button, Field, Notice, Select, TextArea, TextInput } from "./ui.js";
import { UploadField } from "./UploadField.js";

type DeliveryType = "on_demand" | "live" | "praesenz";

const DELIVERY_TYPES: ReadonlyArray<readonly [DeliveryType, string]> = [
  ["on_demand", de.course.deliveryOnDemand],
  ["live", de.course.deliveryLive],
  ["praesenz", de.course.deliveryPraesenz],
];

export function CoursePresentation(props: {
  client: ApiClient;
  course: AdminCourseDetail;
  onSaved: (course: AdminCourseDetail) => void;
}) {
  const { course } = props;
  const [form, setForm] = useState(() => initialForm(course));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  /*
   * Whether the operator has touched anything since the last successful save
   * (P234-01). Edited, not different: one `onChange` on the container catches
   * every control, including any added later, because React's synthetic
   * `change` bubbles — where comparing field by field is a list that a new
   * field silently escapes (§9.3).
   */
  const [edited, setEdited] = useState(false);
  useUnsavedChanges("course-presentation", edited);
  const [problem, setProblem] = useState<string | undefined>();

  /*
   * A different course means a different form, or navigating between two would
   * show the previous one's unsaved edits.
   *
   * Keyed on the **slug**, not on the object (P68-02). It was on the object,
   * and the consequence was that this screen never confirmed a save: `save`
   * sets `saved`, then hands the updated course up to the parent, which sends
   * a new object down — a new identity, so this effect fired and cleared the
   * confirmation in the same commit. The operator saw the button go idle and
   * nothing else.
   *
   * That is the failure mode CLAUDE.md §9.4 is about, in its quietest form: the
   * write succeeded, the screen said nothing, and the only way to find out was
   * to reload and look. Found by the journey suite, which asked for the
   * sentence the screen owes and did not get one.
   */
  useEffect(() => {
    setForm(initialForm(course));
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity is not the question; which course is
  }, [course.slug]);

  function set<K extends keyof ReturnType<typeof initialForm>>(
    key: K,
    value: string,
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      const updated = await props.client.adminUpdateCourse(course.slug, {
        title: form.title.trim(),
        description: emptyToNull(form.description),
        descriptionDetail: emptyToNull(form.descriptionDetail),
        deliveryType: form.deliveryType as DeliveryType,
        thema: lines(form.thema),
        altersgruppe: lines(form.altersgruppe),
        learningObjectives: lines(form.learningObjectives),
        targetAudience: emptyToNull(form.targetAudience),
        prerequisites: emptyToNull(form.prerequisites),
        heroImageUrl: emptyToNull(form.heroImageUrl),
        cmePoints: form.cmePoints.trim() === "" ? null : Number(form.cmePoints),
        cmeCategory: emptyToNull(form.cmeCategory),
        // A date input gives `YYYY-MM-DD`, a German calendar day off the
        // Bescheid; the API wants instants. `windowFromDates` turns "bis
        // 12.10." into the last instant of the 12th in Berlin — this used to
        // send 00:00 UTC, which ended the course at 02:00 on its last
        // accredited day (P243-01).
        ...windowInstants(form.validFrom, form.validTo),
      });
      setSaved(true);
      // The server has it: there is nothing left to lose.
      setEdited(false);
      props.onSaved(updated);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-6"
      // Every control below, including any added after this was written:
      // React's synthetic `change` bubbles, so one handler covers the screen.
      onChange={() => setEdited(true)}
    >
      <p className="text-sm text-gray-700">{de.course.presentationIntro}</p>

      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}
      {saved ? <Notice tone="success">{de.common.saved}</Notice> : null}

      <Field label={de.course.title} htmlFor="course-title">
        <TextInput
          id="course-title"
          value={form.title}
          maxLength={300}
          onChange={(value) => set("title", value)}
        />
      </Field>

      <Field
        label={de.course.description}
        htmlFor="course-description"
        hint={de.course.descriptionHint}
      >
        <TextArea
          id="course-description"
          value={form.description}
          rows={4}
          maxLength={5000}
          onChange={(value) => set("description", value)}
        />
      </Field>

      {/*
        The Mediathek, not a URL to paste (P211-01).

        The client, after building a course: *"we should not have any photo url
        anywhere, all of them should open the mediathek"* — and, on the
        workaround they had been left with, *"I have pasted an URL of a
        plattform image. At least it is working."*

        `UploadField` is the control that already does this everywhere else: it
        uploads, it offers **Aus Mediathek wählen**, and it still accepts a
        pasted URL, which is what keeps a customer's own CDN working (P88-02).
        This field simply never got it.

        `purpose="poster"` is the platform's **image** purpose — it decides the
        accepted types and the size ceiling, and `LIBRARY_KIND` maps it to the
        library's `image` family. The name is historical (video posters were
        the first images the platform stored); adding an `image` purpose would
        be a contract change, an SDK regeneration and a migration for no
        difference an author could see.
      */}
      <UploadField
        label={de.course.heroImageUrl}
        hint={de.course.heroImageHint}
        id="course-hero"
        value={form.heroImageUrl}
        purpose="poster"
        client={props.client}
        courseSlug={course.slug}
        onChange={(value) => set("heroImageUrl", value)}
      />

      <Field label={de.course.deliveryType} htmlFor="course-delivery">
        <Select
          id="course-delivery"
          value={form.deliveryType as DeliveryType}
          options={DELIVERY_TYPES}
          onChange={(value) => set("deliveryType", value)}
        />
      </Field>

      <Field
        label={de.course.thema}
        htmlFor="course-thema"
        hint={de.course.onePerLine}
        wide
      >
        <TextArea
          id="course-thema"
          value={form.thema}
          rows={3}
          onChange={(value) => set("thema", value)}
        />
      </Field>

      <Field
        label={de.course.altersgruppe}
        htmlFor="course-altersgruppe"
        hint={de.course.onePerLine}
      >
        <TextArea
          id="course-altersgruppe"
          value={form.altersgruppe}
          rows={3}
          onChange={(value) => set("altersgruppe", value)}
        />
      </Field>

      {/*
        The detail page's own description (P252-01, DEP-47).

        Directly above Lernziele because that is where the ticket asks for it,
        and it is also where it belongs: the two texts a physician reads on the
        course page, in the order the page draws them.

        Not beside the overview description, which would put the two
        "Beschreibung" fields adjacent and invite an author to paste the same
        paragraph into both — the thing DEP-47 exists to stop.
      */}
      <Field
        label={de.course.descriptionDetail}
        htmlFor="course-description-detail"
        hint={de.course.descriptionDetailHint}
        wide
      >
        <TextArea
          id="course-description-detail"
          value={form.descriptionDetail}
          rows={6}
          maxLength={5000}
          onChange={(value) => set("descriptionDetail", value)}
        />
      </Field>

      <Field
        label={de.course.learningObjectives}
        htmlFor="course-objectives"
        hint={de.course.onePerLineOrdered}
      >
        <TextArea
          id="course-objectives"
          value={form.learningObjectives}
          rows={6}
          onChange={(value) => set("learningObjectives", value)}
        />
      </Field>

      <Field
        label={de.course.targetAudience}
        htmlFor="course-audience"
        hint={de.course.targetAudienceHint}
      >
        <TextArea
          id="course-audience"
          value={form.targetAudience}
          rows={6}
          maxLength={5000}
          onChange={(value) => set("targetAudience", value)}
        />
      </Field>

      {/*
        Its own field rather than the tail of Zielgruppe. The layout labels it
        (page 02), and an author who has to remember to type the label is an
        author who will eventually not.
      */}
      <Field
        label={de.course.prerequisites}
        htmlFor="course-prerequisites"
        hint={de.course.prerequisitesHint}
      >
        <TextArea
          id="course-prerequisites"
          value={form.prerequisites}
          rows={3}
          maxLength={2000}
          onChange={(value) => set("prerequisites", value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={de.course.cmePoints}
          htmlFor="course-points"
          hint={de.course.cmePointsHint}
        >
          <TextInput
            id="course-points"
            value={form.cmePoints}
            inputMode="numeric"
            onChange={(value) => set("cmePoints", value)}
          />
        </Field>
        <Field label={de.course.cmeCategory} htmlFor="course-category">
          <TextInput
            id="course-category"
            value={form.cmeCategory}
            maxLength={50}
            onChange={(value) => set("cmeCategory", value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={de.course.validFrom}
          htmlFor="course-valid-from"
          hint={de.course.validityHint}
        >
          <TextInput
            id="course-valid-from"
            type="date"
            value={form.validFrom}
            onChange={(value) => set("validFrom", value)}
          />
        </Field>
        <Field label={de.course.validTo} htmlFor="course-valid-to">
          <TextInput
            id="course-valid-to"
            type="date"
            value={form.validTo}
            onChange={(value) => set("validTo", value)}
          />
        </Field>
      </div>

      <Button onClick={() => void save()} disabled={busy || form.title.trim() === ""}>
        {busy ? de.common.saving : de.common.save}
      </Button>
    </div>
  );
}

function initialForm(course: AdminCourseDetail) {
  return {
    title: course.title,
    description: course.description ?? "",
    descriptionDetail: course.descriptionDetail ?? "",
    deliveryType: course.deliveryType,
    thema: course.thema.join("\n"),
    altersgruppe: course.altersgruppe.join("\n"),
    learningObjectives: course.learningObjectives.join("\n"),
    targetAudience: course.targetAudience ?? "",
    prerequisites: course.prerequisites ?? "",
    heroImageUrl: course.heroImageUrl ?? "",
    cmePoints: course.cmePoints === null ? "" : String(course.cmePoints),
    cmeCategory: course.cmeCategory ?? "",
    // The Berlin day of each end. Slicing the ISO string read the UTC day, so
    // an end of 21:59:59.999Z showed right by accident and a start of 22:00Z —
    // the first instant of the next Berlin day — showed a day early (P243-01).
    ...datesOfWindow({
      validFrom: course.validFrom === null ? null : new Date(course.validFrom),
      validTo: course.validTo === null ? null : new Date(course.validTo),
    }),
  };
}

/** One item per line, blank lines dropped so a trailing newline is not an item. */
function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `YYYY-MM-DD` for a date input, from the ISO instant the API returns. */
function windowInstants(
  validFrom: string,
  validTo: string,
): { validFrom: string | null; validTo: string | null } {
  const window = windowFromDates(validFrom, validTo);
  return {
    validFrom: window.validFrom?.toISOString() ?? null,
    validTo: window.validTo?.toISOString() ?? null,
  };
}
