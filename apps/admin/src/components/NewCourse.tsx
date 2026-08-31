/**
 * Creating a course (P9-04), as a wizard (P132-03).
 *
 * ## What is still deliberately absent
 *
 * Four fields, and no more. Everything a Teilnahmebescheinigung needs — VNR,
 * points, category, Veranstalter, the wissenschaftliche Leitung, the stamp — is
 * set afterwards on the settings screen, which already refuses a pass threshold
 * below the accredited minimum and reports which certificate fields are still
 * missing. Repeating those rules here would be a second place to get a
 * compliance answer wrong. `CourseCreate` in `contracts/openapi.yaml` says the
 * same thing, and this screen is not the place to argue with it.
 *
 * So the wizard adds no fields. It changes what the author can *see* while
 * filling in the ones that exist.
 *
 * ## Why a wizard for four fields
 *
 * The client's report was about this screen — *"i still do not like the ui of
 * course creation"* — with reference designs that all share two things a flat
 * form does not have: a sense of where you are in a sequence, and a preview of
 * the thing being made. Both are worth having here, for reasons that are not
 * cosmetic:
 *
 * * **The title and the address are one decision made twice.** The slug is
 *   derived from the title until somebody edits it, and *cannot be changed
 *   afterwards*. On the flat form that permanence was a hint under a field
 *   halfway down. Here it is a step, with the address rendered in the preview
 *   exactly as it will read.
 * * **Nothing here is what an author came to do.** They came to build a course;
 *   this form is the door. The last step therefore says what the next three
 *   screens are — structure, certification, publication — because the flat
 *   form dropped the author on an empty structure page with no statement of
 *   what still had to happen before a physician could see anything (§9.4).
 *
 * ## Two things the wizard must not do, and does not
 *
 * 1. **No step may offer something the API will refuse (§9.2).** The reference
 *    designs have a *Pricing* step and an *Upload course materials* step. There
 *    is no pricing on this platform, and materials belong to a content item
 *    that cannot exist before the course does. Drawing either would be a
 *    control whose only possible outcome is an error.
 * 2. **Nothing is written until the last step.** `adminCreateCourse` is called
 *    once, from "Fortbildung anlegen". A wizard that created the course on
 *    step 1 and patched it afterwards would leave a half-made course behind
 *    every time somebody changed their mind.
 *
 * ## The step is not in the address, on purpose
 *
 * §9.8 asks whether a person can link to where they are, and the answer here is
 * no. That is the right answer only because there is nothing behind the step to
 * restore: the draft lives in this component and a reload discards it, so a URL
 * that reopened step 3 would reopen it *empty* — an address that lies about
 * what it leads to. The screen says so instead, at the point somebody might
 * otherwise assume their typing is safe.
 */

import { useMemo, useState } from "react";
import type { ApiClient, CourseCreate, ProjectSummary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { slugify } from "../drafts.js";
import { useSaver } from "../hooks.js";
import { Button, Field, Notice, SaveProblem, Select, TextArea, TextInput } from "./ui.js";

type DeliveryType = NonNullable<CourseCreate["deliveryType"]>;

const DELIVERY_TYPES: ReadonlyArray<readonly [DeliveryType, string]> = [
  ["on_demand", de.newCourse.delivery.on_demand],
  ["live", de.newCourse.delivery.live],
  ["praesenz", de.newCourse.delivery.praesenz],
];

/**
 * The steps, in the order the decisions actually depend on each other.
 *
 * Grunddaten first because the address is derived from the title and is
 * permanent; Darstellung second because it is the only part a physician ever
 * reads; the review last because it is the only place the whole thing is
 * visible at once.
 */
const STEPS = ["basics", "presentation", "review"] as const;
type Step = (typeof STEPS)[number];

export function NewCourse(props: {
  client: ApiClient;
  projects: readonly ProjectSummary[];
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  const first = props.projects[0];
  const [projectSlug, setProjectSlug] = useState(first?.slug ?? "");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [description, setDescription] = useState("");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("on_demand");
  const [step, setStep] = useState<Step>("basics");
  const saver = useSaver();

  const effectiveSlug = touchedSlug ? slug : slugify(title);
  const projectOptions = useMemo(
    () => props.projects.map((project) => [project.slug, project.name] as const),
    [props.projects],
  );

  /*
   * What is missing, by field name — never by value (§9.5).
   *
   * Rendered rather than only used to disable the button: a control that has
   * gone grey and does not say why is the same defect as one that can only
   * produce an error, one step earlier.
   */
  const missing: string[] = [];
  if (title.trim() === "") missing.push(de.common.title);
  if (effectiveSlug === "") missing.push(de.common.slug);
  if (projectSlug === "") missing.push(de.newCourse.project);

  const index = STEPS.indexOf(step);
  const canLeaveBasics = missing.length === 0;

  // No "Zurück" button out of the whole screen: the page's trail is the way
  // back on every screen now (P30-02). "Zurück" *inside* the wizard is a
  // different control and means one step, not one screen.
  if (props.projects.length === 0) {
    return <Notice tone="warning">{de.newCourse.noProjects}</Notice>;
  }

  const submit = () =>
    void saver.run(async () => {
      const structure = await props.client.adminCreateCourse({
        projectSlug,
        slug: effectiveSlug,
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        deliveryType,
      });
      props.onCreated(structure.courseSlug);
    });

  return (
    // Heading and intro come from `Page` (P30-02).
    <section className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          <StepRail current={step} onGo={setStep} canLeaveBasics={canLeaveBasics} />

          <form
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (step === "review") submit();
            }}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {de.newCourse.stepOf(index + 1, STEPS.length)}
            </p>
            {/* h3, under the page's own h2 — the step is a section of this
                screen, not a second screen. */}
            <h3 className="mt-1 text-base font-semibold text-gray-900">
              {de.newCourse.steps[step]}
            </h3>
            <p className="mt-1 max-w-prose text-sm text-gray-600">
              {de.newCourse.stepHints[step]}
            </p>

            <div className="mt-4 space-y-3">
              {step === "basics" ? (
                <>
                  <Field label={de.newCourse.project} htmlFor="new-course-project">
                    <Select
                      id="new-course-project"
                      value={projectSlug}
                      options={projectOptions}
                      onChange={setProjectSlug}
                    />
                  </Field>

                  <Field label={de.common.title} htmlFor="new-course-title">
                    <TextInput
                      id="new-course-title"
                      value={title}
                      maxLength={300}
                      onChange={setTitle}
                    />
                  </Field>

                  <Field
                    label={de.common.slug}
                    hint={de.common.slugHint}
                    htmlFor="new-course-slug"
                  >
                    <TextInput
                      id="new-course-slug"
                      value={effectiveSlug}
                      maxLength={100}
                      onChange={(value) => {
                        setTouchedSlug(true);
                        setSlug(value);
                      }}
                    />
                  </Field>
                </>
              ) : null}

              {step === "presentation" ? (
                <>
                  <Field label={de.newCourse.deliveryType} htmlFor="new-course-delivery">
                    <Select
                      id="new-course-delivery"
                      value={deliveryType}
                      options={DELIVERY_TYPES}
                      onChange={setDeliveryType}
                    />
                  </Field>

                  <Field
                    label={de.newCourse.description}
                    hint={de.newCourse.descriptionHint}
                    htmlFor="new-course-description"
                  >
                    <TextArea
                      id="new-course-description"
                      value={description}
                      rows={7}
                      maxLength={20_000}
                      onChange={setDescription}
                    />
                  </Field>
                </>
              ) : null}

              {step === "review" ? (
                <Review
                  projectName={
                    props.projects.find((project) => project.slug === projectSlug)
                      ?.name ?? projectSlug
                  }
                  title={title.trim()}
                  slug={effectiveSlug}
                  deliveryType={deliveryType}
                  description={description.trim()}
                />
              ) : null}
            </div>

            <SaveProblem title={de.error.title} problem={saver.problem} />

            {missing.length === 0 ? null : (
              <p className="mt-3 text-xs font-medium text-amber-700" role="status">
                {de.newCourse.missing(missing)}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              {/* Keyed for the same reason as the pair below, before the two
                  ever differ in `type`. */}
              {index === 0 ? (
                <Button key="cancel" variant="secondary" onClick={props.onCancel}>
                  {de.common.cancel}
                </Button>
              ) : (
                <Button
                  key="back"
                  variant="secondary"
                  onClick={() => setStep(STEPS[index - 1] ?? "basics")}
                >
                  {de.newCourse.back}
                </Button>
              )}

              {/*
                Two buttons, two **keys**, and the keys are the fix rather than
                a tidying (P132-03).

                Without them React sees one `<button>` in one position and
                reuses the DOM node between steps — it only rewrites the text
                and the `type`. A click is dispatched, React's `onClick` runs
                and flushes the state update synchronously (a click is a
                discrete event), and *only then* does the browser perform the
                element's activation behaviour — by which time the node it is
                about to activate is no longer "Weiter, type=button" but
                "Fortbildung anlegen, type=submit". The form submits, and the
                course is created by the click that was meant to *show* the
                review step. The author never sees it.

                That is not a test artefact: the last press of Weiter created a
                course, every time, for everybody. It was found by the browser
                journey and could not have been found by a component test —
                jsdom does not run the activation behaviour the same way, and
                the case above ("writes nothing before the last step") passes
                on the broken build. CLAUDE.md §9.13, exactly.

                Distinct keys make them distinct elements, so React unmounts one
                and mounts the other and the click's default action lands on a
                node that is no longer in any form.
              */}
              {step === "review" ? (
                <Button
                  key="create"
                  type="submit"
                  disabled={saver.state === "saving" || !canLeaveBasics}
                >
                  {saver.state === "saving" ? de.common.saving : de.newCourse.create}
                </Button>
              ) : (
                <Button
                  key="next"
                  onClick={() => setStep(STEPS[index + 1] ?? "review")}
                  disabled={!canLeaveBasics}
                >
                  {de.newCourse.next}
                </Button>
              )}

              <span className="ml-auto text-xs text-gray-500">
                {de.newCourse.notSaved}
              </span>
            </div>
          </form>
        </div>

        <Preview
          title={title.trim()}
          slug={effectiveSlug}
          deliveryType={deliveryType}
          description={description.trim()}
        />
      </div>
    </section>
  );
}

/**
 * The steps as a control, not as decoration.
 *
 * Every step is reachable by clicking it, forwards as well as back — an author
 * who wants to reread the address while writing the description should not have
 * to walk through the wizard to do it. The one exception is leaving Grunddaten
 * with a missing title or address, which is the state the create call would be
 * refused in: the button says why rather than going quietly grey (§9.4).
 */
function StepRail(props: {
  current: Step;
  canLeaveBasics: boolean;
  onGo: (step: Step) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label={de.newCourse.stepsLabel}>
      {STEPS.map((step, at) => {
        const active = step === props.current;
        const locked = step !== "basics" && !props.canLeaveBasics;
        return (
          <li key={step} className="min-w-0 flex-1">
            <button
              type="button"
              aria-current={active ? "step" : undefined}
              disabled={locked}
              onClick={() => props.onGo(step)}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left ${
                active
                  ? "border-brand-500 bg-brand-50"
                  : locked
                    ? "border-gray-200 bg-gray-50 text-gray-400"
                    : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                  active
                    ? "bg-brand-600 text-white"
                    : locked
                      ? "bg-gray-200 text-gray-500"
                      : "bg-gray-100 text-gray-700"
                }`}
              >
                {at + 1}
              </span>
              <span
                className={`min-w-0 truncate text-sm font-medium ${
                  active ? "text-brand-800" : locked ? "text-gray-400" : "text-gray-900"
                }`}
              >
                {de.newCourse.steps[step]}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The catalogue card, drawn from the draft.
 *
 * It is a *likeness*, and the badge says so: the portal renders the real one
 * from the published course with the customer's branding applied, and a preview
 * claiming to be that would be a second implementation of a screen this console
 * does not own. What it is honest about is the part authors get wrong — how
 * long the title reads, and that the description is the only sentence anybody
 * sees before deciding to open the course.
 */
function Preview(props: {
  title: string;
  slug: string;
  deliveryType: DeliveryType;
  description: string;
}) {
  return (
    <aside className="lg:sticky lg:top-4">
      <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {de.newCourse.preview}
      </p>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="h-2 bg-[color:var(--ds-brand-500)]" />
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
              {de.newCourse.delivery[props.deliveryType]}
            </span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {de.newCourse.draftBadge}
            </span>
          </div>

          <h3
            className={`text-sm font-semibold ${
              props.title === "" ? "text-gray-400" : "text-gray-900"
            }`}
          >
            {props.title === "" ? de.newCourse.previewNoTitle : props.title}
          </h3>

          <p
            className={`text-xs ${
              props.description === "" ? "italic text-gray-400" : "text-gray-600"
            }`}
          >
            {props.description === ""
              ? de.newCourse.previewNoDescription
              : props.description}
          </p>
        </div>
        <div className="border-t border-gray-100 px-4 py-2">
          <span className="text-[11px] text-gray-500">{de.common.slug}: </span>
          <span className="font-mono text-[11px] text-gray-800">
            {props.slug === "" ? "—" : props.slug}
          </span>
        </div>
      </div>
      <p className="px-1 pt-2 text-[11px] text-gray-500">{de.newCourse.previewHint}</p>
    </aside>
  );
}

/**
 * The last step: everything about to be written, and everything that will still
 * be missing afterwards.
 *
 * The second half is the part the flat form had nowhere to put. A new course is
 * a draft with no modules, no VNR and no certificate fields, and an author who
 * does not know that reads the empty structure screen as a broken one.
 */
function Review(props: {
  projectName: string;
  title: string;
  slug: string;
  deliveryType: DeliveryType;
  description: string;
}) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    [de.newCourse.project, props.projectName],
    [de.common.title, props.title === "" ? "—" : props.title],
    [de.common.slug, props.slug === "" ? "—" : props.slug],
    [de.newCourse.deliveryType, de.newCourse.delivery[props.deliveryType]],
    [
      de.newCourse.description,
      props.description === "" ? de.newCourse.previewNoDescription : props.description,
    ],
  ];

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]"
          >
            <dt className="text-xs font-medium text-gray-500">{label}</dt>
            <dd className="break-words text-sm text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-semibold text-gray-900">{de.newCourse.nextTitle}</p>
        <ol className="mt-2 space-y-1.5">
          {de.newCourse.nextSteps.map((entry, at) => (
            <li key={entry.title} className="flex gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white text-[11px] font-semibold text-gray-700">
                {at + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-gray-900">
                  {entry.title}
                </span>
                <span className="block text-xs text-gray-600">{entry.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
