/**
 * The Experten/Referenten list (P9-04).
 *
 * The one authoring screen that replaces wholesale rather than diffing, and the
 * reason is that no learner state points at an expert. Nothing here is evidence
 * behind a CME point, so there is no row whose deletion destroys a record — and
 * a full replace is what the screen does anyway, since the list is short and
 * edited as a block.
 *
 * It reads the list out of `GET /admin/courses/{slug}/structure` rather than
 * from an endpoint of its own, and writes back the whole array. The structure
 * response already carries the experts, so there is one shape describing a
 * course's contents and its people — a second endpoint would be a second answer
 * that could disagree with the first.
 */

import { useCallback, useState } from "react";
import type { ApiClient, AuthoringExpert } from "@ds/sdk";
import { de } from "../locale/de.js";
import { freshKey, nullable, swap } from "../drafts.js";
import { useLoaded, useSaver } from "../hooks.js";
import {
  Button,
  Field,
  IconButton,
  LoadFailure,
  Notice,
  Panel,
  SaveProblem,
  Spinner,
  TextArea,
  TextInput,
} from "./ui.js";

interface Draft {
  readonly key: string;
  roleLabel: string;
  name: string;
  institution: string;
  biography: string;
  photoUrl: string;
}

export function ExpertsEditor(props: { client: ApiClient; courseSlug: string }) {
  const { client, courseSlug } = props;

  const load = useCallback(
    () => client.adminGetStructure(courseSlug),
    [client, courseSlug],
  );
  const [structure, setStructure, loadProblem, retry] = useLoaded(load);
  const [draft, setDraft] = useState<Draft[] | undefined>();
  const saver = useSaver();

  const experts =
    draft ?? (structure === undefined ? undefined : structure.experts.map(toDraft));

  if (loadProblem !== undefined) {
    return (
      <LoadFailure
        title={de.error.title}
        retryLabel={de.error.retry}
        problem={loadProblem}
        onRetry={retry}
      />
    );
  }

  if (experts === undefined) return <Spinner label={de.loading} />;

  const setExperts = (next: Draft[]) => setDraft(next);

  const incomplete = experts.some(
    (expert) => expert.name.trim() === "" || expert.roleLabel.trim() === "",
  );

  return (
    <section className="space-y-4">
      <p className="max-w-3xl text-sm text-gray-600">{de.experts.intro}</p>

      <SaveProblem title={de.error.title} problem={saver.problem} />
      {saver.state === "saved" && draft === undefined ? (
        <Notice tone="success">{de.common.saved}</Notice>
      ) : null}

      {experts.length === 0 ? (
        <p className="text-sm text-gray-600">{de.experts.empty}</p>
      ) : (
        <ol className="space-y-3">
          {experts.map((expert, index) => (
            <li key={expert.key}>
              <Panel
                title={`${index + 1}.`}
                actions={
                  <>
                    <IconButton
                      label={de.common.moveUp}
                      glyph="↑"
                      disabled={index === 0}
                      onClick={() => setExperts(swap(experts, index, index - 1))}
                    />
                    <IconButton
                      label={de.common.moveDown}
                      glyph="↓"
                      disabled={index === experts.length - 1}
                      onClick={() => setExperts(swap(experts, index, index + 1))}
                    />
                    <IconButton
                      label={de.common.delete}
                      glyph="×"
                      onClick={() => setExperts(experts.filter((_, i) => i !== index))}
                    />
                  </>
                }
              >
                <ExpertFields
                  expert={expert}
                  onChange={(next) =>
                    setExperts(experts.map((e, i) => (i === index ? next : e)))
                  }
                />
              </Panel>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setExperts([...experts, blank()])}>
          {de.experts.add}
        </Button>
        <Button
          disabled={saver.state === "saving" || incomplete}
          onClick={() => {
            void saver.run(async () => {
              setStructure(
                await client.adminReplaceExperts(courseSlug, {
                  experts: experts.map((expert) => ({
                    roleLabel: expert.roleLabel.trim(),
                    name: expert.name.trim(),
                    institution: nullable(expert.institution),
                    biography: nullable(expert.biography),
                    photoUrl: nullable(expert.photoUrl),
                  })),
                }),
              );
              // Back to rendering the server's list: the rows it just stored
              // have ids, and the draft's do not.
              setDraft(undefined);
            });
          }}
        >
          {saver.state === "saving" ? de.common.saving : de.common.save}
        </Button>
      </div>
    </section>
  );
}

function ExpertFields(props: { expert: Draft; onChange: (next: Draft) => void }) {
  const { expert } = props;
  const id = (field: string) => `expert-${expert.key}-${field}`;
  const set = (change: Partial<Draft>) => props.onChange({ ...expert, ...change });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={de.experts.roleLabel}
          hint={de.experts.roleLabelHint}
          htmlFor={id("role")}
        >
          <TextInput
            id={id("role")}
            value={expert.roleLabel}
            maxLength={100}
            onChange={(roleLabel) => set({ roleLabel })}
          />
        </Field>
        <Field label={de.experts.name} htmlFor={id("name")}>
          <TextInput
            id={id("name")}
            value={expert.name}
            maxLength={200}
            onChange={(name) => set({ name })}
          />
        </Field>
        <Field label={de.experts.institution} htmlFor={id("institution")}>
          <TextInput
            id={id("institution")}
            value={expert.institution}
            maxLength={300}
            onChange={(institution) => set({ institution })}
          />
        </Field>
        <Field label={de.experts.photoUrl} htmlFor={id("photo")}>
          <TextInput
            id={id("photo")}
            value={expert.photoUrl}
            maxLength={2000}
            onChange={(photoUrl) => set({ photoUrl })}
          />
        </Field>
      </div>
      <Field label={de.experts.biography} htmlFor={id("bio")}>
        <TextArea
          id={id("bio")}
          value={expert.biography}
          rows={3}
          maxLength={20_000}
          onChange={(biography) => set({ biography })}
        />
      </Field>
    </div>
  );
}

function toDraft(expert: AuthoringExpert): Draft {
  return {
    key: expert.id,
    roleLabel: expert.roleLabel,
    name: expert.name,
    institution: expert.institution ?? "",
    biography: expert.biography ?? "",
    photoUrl: expert.photoUrl ?? "",
  };
}

function blank(): Draft {
  return {
    key: freshKey(),
    roleLabel: "",
    name: "",
    institution: "",
    biography: "",
    photoUrl: "",
  };
}
