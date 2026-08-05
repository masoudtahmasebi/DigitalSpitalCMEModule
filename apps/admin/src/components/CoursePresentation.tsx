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
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Button, Field, Notice, Select, TextArea, TextInput } from "./ui.js";

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
  const [problem, setProblem] = useState<string | undefined>();

  // A different course means a different form, or navigating between two would
  // show the previous one's unsaved edits.
  useEffect(() => {
    setForm(initialForm(course));
    setSaved(false);
  }, [course]);

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
        deliveryType: form.deliveryType as DeliveryType,
        thema: lines(form.thema),
        altersgruppe: lines(form.altersgruppe),
        learningObjectives: lines(form.learningObjectives),
        targetAudience: emptyToNull(form.targetAudience),
        heroImageUrl: emptyToNull(form.heroImageUrl),
        cmePoints: form.cmePoints.trim() === "" ? null : Number(form.cmePoints),
        cmeCategory: emptyToNull(form.cmeCategory),
        fortbildungsnummer: emptyToNull(form.fortbildungsnummer),
        // A date input gives `YYYY-MM-DD`; the API wants an instant. Midnight
        // UTC rather than local, so the stored value does not shift by a day
        // depending on which side of the German summer-time change it is read.
        validFrom: toInstant(form.validFrom),
        validTo: toInstant(form.validTo),
      });
      setSaved(true);
      props.onSaved(updated);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
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

      <Field
        label={de.course.heroImageUrl}
        htmlFor="course-hero"
        hint={de.course.heroImageHint}
      >
        <TextInput
          id="course-hero"
          value={form.heroImageUrl}
          maxLength={2000}
          onChange={(value) => set("heroImageUrl", value)}
        />
      </Field>

      <Field label={de.course.deliveryType} htmlFor="course-delivery">
        <Select
          id="course-delivery"
          value={form.deliveryType as DeliveryType}
          options={DELIVERY_TYPES}
          onChange={(value) => set("deliveryType", value)}
        />
      </Field>

      <Field label={de.course.thema} htmlFor="course-thema" hint={de.course.onePerLine}>
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
        <Field label={de.course.fortbildungsnummer} htmlFor="course-fbn">
          <TextInput
            id="course-fbn"
            value={form.fortbildungsnummer}
            maxLength={100}
            onChange={(value) => set("fortbildungsnummer", value)}
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
    deliveryType: course.deliveryType,
    thema: course.thema.join("\n"),
    altersgruppe: course.altersgruppe.join("\n"),
    learningObjectives: course.learningObjectives.join("\n"),
    targetAudience: course.targetAudience ?? "",
    heroImageUrl: course.heroImageUrl ?? "",
    cmePoints: course.cmePoints === null ? "" : String(course.cmePoints),
    cmeCategory: course.cmeCategory ?? "",
    fortbildungsnummer: course.fortbildungsnummer ?? "",
    validFrom: dateInput(course.validFrom),
    validTo: dateInput(course.validTo),
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
function dateInput(iso: string | null): string {
  return iso === null ? "" : (iso.slice(0, 10) ?? "");
}

function toInstant(value: string): string | null {
  return value.trim() === "" ? null : `${value}T00:00:00.000Z`;
}
