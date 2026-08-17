/**
 * Texte — the customer's own words for the learner's screens (P83-04).
 *
 * ## Why every key is listed, including the ones that cannot be changed
 *
 * Asked for directly: _"you can make both of them available and let the
 * customer only edit the editable parts."_ Which is right, and is the opposite
 * of the tempting shortcut. A screen that silently omitted the interpolated
 * sentences would leave somebody scrolling for "4 CME-Punkte", not finding it,
 * and concluding the search was broken — an absent field reads as an
 * unfinished feature (CLAUDE.md §9.4). So they are drawn, disabled, with the
 * reason next to them.
 *
 * The reason is real: those sentences are functions because German agreement is
 * decided in code — "1 Punkt" against "4 Punkten". Handing them over as
 * templates would lose the singular and put "1 Punkte" on an accredited course.
 *
 * ## Why the default is always visible
 *
 * The field shows the customer's text when they have set one and the platform's
 * as a placeholder when they have not, so the box is never blank and never
 * lies about what a learner currently sees. Clearing a field is how you go back
 * to the default — which is why an empty value is stored as "no override"
 * rather than as an empty label.
 *
 * ## Why the project is chosen here
 *
 * Copy is stored per project, because a customer can run more than one — a
 * WordPress channel and a portal channel exist for MEDICE today, and they are
 * the same words only by coincidence. The selector makes that visible rather
 * than picking one and leaving somebody to wonder which they just edited.
 */

import { useEffect, useMemo, useState } from "react";
import { copyDefaultAt, copyKeysOf } from "@ds/domain";
import { de as widgetCopy } from "@ds/copy";
import type { ApiClient, ProjectSummary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Button, Notice, Select, TextInput } from "./ui.js";

/**
 * Every key in the widget's locale table, editable or not.
 *
 * `copyKeysOf` gives the editable ones. The full walk below adds the rest, so
 * "what a customer can see" and "what a customer can change" are two lists
 * derived from one table rather than two lists maintained in parallel.
 */
function allKeys(node: unknown, prefix = ""): readonly string[] {
  if (node === null || typeof node !== "object") return [];
  const keys: string[] = [];
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    if (typeof value === "string" || typeof value === "function") {
      keys.push(path);
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...allKeys(value, path));
    }
  }
  return keys;
}

export function CopySettings(props: { client: ApiClient }) {
  const { client } = props;

  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [slug, setSlug] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const editable = useMemo(() => new Set(copyKeysOf(widgetCopy)), []);
  const keys = useMemo(() => allKeys(widgetCopy), []);

  useEffect(() => {
    client.adminListProjects().then(
      (rows) => {
        setProjects(rows);
        const first = rows[0];
        if (first !== undefined) {
          setSlug(first.slug);
          setDraft({ ...first.copyOverrides });
        }
      },
      (error: unknown) => setProblem(describeError(error, de.error.generic)),
    );
  }, [client]);

  function chooseProject(next: string): void {
    setSlug(next);
    setSaved(false);
    setProblem(undefined);
    const project = projects.find((entry) => entry.slug === next);
    setDraft({ ...(project?.copyOverrides ?? {}) });
  }

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      /*
       * Blank fields are sent as `""` rather than dropped, because `""` is how
       * the API is told to *remove* an override. Omitting the key would mean
       * "leave it as it is", and there would be no way to undo a change.
       */
      const rows = await client.adminUpdateProject(slug, { copyOverrides: draft });
      setProjects(rows);
      const project = rows.find((entry) => entry.slug === slug);
      setDraft({ ...(project?.copyOverrides ?? {}) });
      setSaved(true);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const shown = keys.filter((key) => {
    if (needle === "") return true;
    const fallback = copyDefaultAt(widgetCopy, key) ?? "";
    return key.toLowerCase().includes(needle) || fallback.toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-[color:var(--ds-ink-muted)]">
        {de.copy.intro}
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{de.copy.project}</span>
          <Select
            id="ds-copy-project"
            value={slug}
            onChange={chooseProject}
            aria-label={de.copy.project}
            options={projects.map(
              (entry) => [entry.slug, `${entry.name} (${entry.slug})`] as const,
            )}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{de.copy.filter}</span>
          <TextInput
            id="ds-copy-filter"
            aria-label={de.copy.filter}
            value={filter}
            maxLength={60}
            onChange={setFilter}
          />
        </label>
      </div>

      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {!saved ? null : <Notice tone="success">{de.copy.saved}</Notice>}

      <p className="text-xs text-[color:var(--ds-ink-muted)]">
        {de.copy.counts(shown.length, keys.length)}
      </p>

      <ul className="space-y-3">
        {shown.map((key) => {
          const fallback = copyDefaultAt(widgetCopy, key);
          const isEditable = editable.has(key);
          return (
            <li
              key={key}
              className="rounded-md border border-[color:var(--ds-hairline)] p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <code className="text-xs text-[color:var(--ds-ink-muted)]">{key}</code>
                {isEditable ? null : (
                  <span className="text-xs text-[color:var(--ds-ink-muted)]">
                    {de.copy.fixed}
                  </span>
                )}
              </div>

              {isEditable ? (
                <div className="mt-2">
                  <TextInput
                    id={`ds-copy-${key}`}
                    aria-label={key}
                    value={draft[key] ?? ""}
                    maxLength={2000}
                    onChange={(value: string) => {
                      setSaved(false);
                      setDraft((current) => ({ ...current, [key]: value }));
                    }}
                  />
                  <p className="mt-1 text-xs text-[color:var(--ds-ink-muted)]">
                    {de.copy.fallback(fallback ?? "")}
                  </p>
                </div>
              ) : (
                /*
                 * Drawn, not hidden. Somebody looking for this sentence finds
                 * it and finds out why it is not theirs to change, instead of
                 * concluding the list is incomplete.
                 */
                <p className="mt-2 text-sm text-[color:var(--ds-ink-muted)]">
                  {de.copy.fixedHint}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Button onClick={() => void save()} disabled={busy || slug === ""}>
        {busy ? de.copy.saving : de.copy.save}
      </Button>
    </div>
  );
}
