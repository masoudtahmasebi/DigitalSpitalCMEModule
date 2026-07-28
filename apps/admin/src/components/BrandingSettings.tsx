/**
 * The white-label typeface (P10-08).
 *
 * ## Why this screen exists at all
 *
 * The platform is sold to more than one customer, so the font is data on the
 * project rather than a constant in a stylesheet. A customer's brand manual
 * names a typeface; without this screen, honouring it would mean a deployment.
 *
 * ## Why the file is uploaded rather than a URL entered
 *
 * A field asking for a font URL would be filled in with a Google Fonts link
 * within the week, and a German healthcare site that loads a webfont from
 * Google transmits every visitor's IP address to a US service — which LG
 * München I (3 O 17493/20) found unlawful without consent. Uploading the file
 * makes that impossible rather than discouraged: the font is served from the
 * API's own origin and no third party is ever contacted.
 *
 * ## What this screen does not do
 *
 * It does not validate the file. The browser check below is a courtesy that
 * saves a round trip on an obvious mistake; the server reads the container
 * signature and rejects anything that is not woff2 or woff regardless of what
 * was uploaded, what it was called, or what the browser declared it to be.
 */

import { useEffect, useState } from "react";
import type { ApiClient, FontState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Badge, Button, Field, Notice, TextInput } from "./ui.js";

/** Mirrors the column bound and the server's check (migration 0008). */
const MAX_FONT_BYTES = 2 * 1024 * 1024;

/** Mirrors `FONT_FAMILY_NAME` in `@ds/domain`, which is the authority. */
const FAMILY_NAME = /^[A-Za-z0-9 _-]{1,64}$/;

export function BrandingSettings(props: { client: ApiClient }) {
  const { client } = props;

  const [state, setState] = useState<FontState | undefined>();
  const [familyName, setFamilyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client.adminGetFont().then(
      (font) => {
        setState(font);
        setFamilyName(font.fontFamilyName ?? "");
      },
      (error: unknown) => setProblem(describeError(error, de.error.generic)),
    );
  }, [client]);

  const nameValid = FAMILY_NAME.test(familyName.trim());

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      // Checked here only to save an obviously doomed 2 MB round trip. The
      // server checks the same thing and does not believe this one.
      if (file.size > MAX_FONT_BYTES) {
        setProblem(de.branding.tooLarge);
        return;
      }

      const font = await client.adminSetFont({
        fontBase64: await readBase64(file),
        fontFamilyName: familyName.trim(),
      });
      setState(font);
      setSaved(true);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      const font = await client.adminClearFont();
      setState(font);
      setFamilyName("");
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  const stored = state?.fontFamilyName !== null && state?.fontFamilyName !== undefined;

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-gray-900">{de.branding.title}</h2>
        <p className="text-sm text-gray-700">{de.branding.intro}</p>
        <p className="text-xs text-gray-600">{de.branding.privacy}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={stored ? "ok" : "muted"}>
          {stored ? de.branding.stored : de.branding.none}
        </Badge>
        {stored && state !== undefined ? (
          <span className="text-sm text-gray-700">
            {state.fontFamilyName}
            {state.fontBytes === null ? "" : ` · ${formatKb(state.fontBytes)}`}
          </span>
        ) : null}
      </div>

      <Field
        label={de.branding.familyName}
        hint={de.branding.familyNameHint}
        htmlFor="font-family-name"
        // Spread rather than `problem={undefined}`: `exactOptionalPropertyTypes`
        // distinguishes "absent" from "present and undefined", and an optional
        // prop means the former.
        {...(familyName.trim() === "" || nameValid
          ? {}
          : { problem: de.branding.familyNameInvalid })}
      >
        <TextInput
          id="font-family-name"
          value={familyName}
          maxLength={64}
          onChange={setFamilyName}
        />
      </Field>

      <div className="space-y-2">
        <label htmlFor="font-file" className="block text-sm font-medium text-gray-900">
          {de.branding.file}
        </label>
        <input
          id="font-file"
          type="file"
          accept=".woff2,.woff,font/woff2,font/woff"
          // A file with no family name would be stored under a name nothing
          // references, so the picker waits for one.
          disabled={busy || !nameValid}
          className="text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void upload(file);
            // Cleared so re-selecting the same file fires change again.
            event.target.value = "";
          }}
        />
        <p className="text-xs text-gray-600">{de.branding.fileHint}</p>
      </div>

      {busy ? <p className="text-sm text-gray-600">{de.course.uploading}</p> : null}
      {saved ? <Notice tone="success">{de.branding.saved}</Notice> : null}
      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}

      {stored ? (
        <div className="border-t border-gray-200 pt-4">
          <Button variant="secondary" disabled={busy} onClick={() => void clear()}>
            {de.branding.remove}
          </Button>
          <p className="mt-1 text-xs text-gray-600">{de.branding.removeHint}</p>
        </div>
      ) : null}
    </section>
  );
}

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** `FileReader` gives a data URL; the API wants the payload without the prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read the selected file"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
