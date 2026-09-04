/**
 * Fetching the Teilnahmebescheinigung, in one place (P195-01).
 *
 * ## Why this is its own module
 *
 * Two screens now offer the download: the Zertifizierung tab's
 * `CertificatePanel`, which shows the fields a physician should check first,
 * and the Punktemeldung step's `done` state, which is where somebody who has
 * finished actually is (§9.4). A second copy of the fetch would be a second
 * copy of the part that matters — the object URL is revoked immediately after
 * the click, because a live `blob:` URL is a readable copy of a named
 * physician's participation record for as long as it exists.
 *
 * It goes through the SDK rather than a plain `<a href>` because the endpoint
 * needs a bearer token, which an anchor cannot carry.
 */

import { useState } from "react";
import type { ApiClient } from "@ds/sdk";
import { de } from "./locale/de.js";
import { describeError } from "./hooks.js";

export type CertificateDownload = {
  /** Starts the download. Safe to call while one is already running. */
  readonly start: () => void;
  readonly busy: boolean;
  /** A sentence to render, or `undefined` when the last attempt was fine. */
  readonly problem: string | undefined;
};

export function useCertificateDownload(
  client: ApiClient,
  courseSlug: string,
): CertificateDownload {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function run(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      const { blob, filename } = await client.downloadCertificate(courseSlug);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setProblem(
        describeError(error instanceof Error ? error : undefined, {
          unauthenticated: de.error.unauthenticated,
          generic: de.error.generic,
          noCourse: de.error.noCourse,
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    // A second click while the first is in flight would fetch the PDF twice and
    // save two copies, which looks to the physician like the button misfired.
    start: () => {
      if (busy) return;
      void run();
    },
    busy,
    problem,
  };
}
