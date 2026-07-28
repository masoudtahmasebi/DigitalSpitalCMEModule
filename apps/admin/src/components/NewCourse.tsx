/**
 * Creating a course (P9-04).
 *
 * Deliberately four fields. Everything a Teilnahmebescheinigung needs — VNR,
 * points, category, Veranstalter, the wissenschaftliche Leitung, the stamp —
 * is set afterwards on the settings screen, which already refuses a pass
 * threshold below the accredited minimum and reports which certificate fields
 * are still missing. Repeating those rules in a creation form would be a second
 * place to get a compliance answer wrong, and the first thing an author does
 * after creating a course is open that screen anyway.
 */

import { useMemo, useState } from "react";
import type { ApiClient, CourseCreate, ProjectSummary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { slugify } from "../drafts.js";
import { useSaver } from "../hooks.js";
import { Button, Field, Notice, Select, TextArea, TextInput } from "./ui.js";

type DeliveryType = NonNullable<CourseCreate["deliveryType"]>;

const DELIVERY_TYPES: ReadonlyArray<readonly [DeliveryType, string]> = [
  ["on_demand", de.newCourse.delivery.on_demand],
  ["live", de.newCourse.delivery.live],
  ["praesenz", de.newCourse.delivery.praesenz],
];

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
  const saver = useSaver();

  const effectiveSlug = touchedSlug ? slug : slugify(title);
  const projectOptions = useMemo(
    () => props.projects.map((project) => [project.slug, project.name] as const),
    [props.projects],
  );

  if (props.projects.length === 0) {
    return (
      <div className="space-y-3">
        <Notice tone="warning">{de.newCourse.noProjects}</Notice>
        <Button variant="secondary" onClick={props.onCancel}>
          {de.nav.back}
        </Button>
      </div>
    );
  }

  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-base font-semibold text-gray-900">{de.newCourse.title}</h2>
      <p className="text-sm text-gray-600">{de.newCourse.intro}</p>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
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
        }}
      >
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

        <Field label={de.common.slug} hint={de.common.slugHint} htmlFor="new-course-slug">
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

        <Field label={de.newCourse.deliveryType} htmlFor="new-course-delivery">
          <Select
            id="new-course-delivery"
            value={deliveryType}
            options={DELIVERY_TYPES}
            onChange={setDeliveryType}
          />
        </Field>

        <Field label={de.newCourse.description} htmlFor="new-course-description">
          <TextArea
            id="new-course-description"
            value={description}
            rows={4}
            maxLength={20_000}
            onChange={setDescription}
          />
        </Field>

        {saver.problem === undefined ? null : (
          <Notice tone="error" title={de.error.title}>
            {saver.problem}
          </Notice>
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={
              saver.state === "saving" || title.trim() === "" || effectiveSlug === ""
            }
          >
            {saver.state === "saving" ? de.common.saving : de.newCourse.create}
          </Button>
          <Button variant="secondary" onClick={props.onCancel}>
            {de.common.cancel}
          </Button>
        </div>
      </form>
    </section>
  );
}
