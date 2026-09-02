/**
 * Adding files from the Mediathek itself (P131-01).
 *
 * ## The gap this closes
 *
 * Reported directly: *"in mediathek there is no option to upload."* True since
 * the screen existed. P88-01 built the library as a place to **manage** files —
 * rename, describe, remove, see what is taking four hundred megabytes — and
 * every way of getting a file *in* stayed inside a course form. So the screen
 * called "Mediathek" was the one place you could not add media.
 *
 * ## Why it asks which course
 *
 * Because every key is `<customerId>/courses/<courseId>/<filename>`
 * (`storage-key.ts`), and there is no customer-level keyspace. The library
 * *lists* across courses; the bucket still files everything under one.
 *
 * Asking is the honest version of that. The alternative — inventing a second
 * key shape days before a launch — would give one file two ways to be addressed,
 * and `keyBelongsToCustomer`, `media-url.ts` and the audit log would each need
 * to learn both. Raised as a follow-up rather than absorbed here.
 *
 * ## Large files
 *
 * Past the threshold this uses `uploadInParts`, so a 3 GB lecture is 96 retryable
 * parts rather than one PUT that is worth nothing if it drops at 90 %. Below it,
 * the single-ticket path, which is cheaper for a 2 MB poster.
 *
 * The choice is `planFile`'s, from the same constants the server uses. Nothing
 * here decides a limit.
 */

import { useCallback, useRef, useState } from "react";
import {
  uploadInParts,
  uploadToTicket,
  type AdminCourseSummary,
  type ApiClient,
} from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { acceptedMimeTypes, planFile } from "../media-upload.js";
import { Button, Notice, Select } from "./ui.js";

interface Progress {
  readonly name: string;
  readonly percent: number;
  readonly problem?: string;
  readonly done?: boolean;
}

export function MediaUpload(props: {
  client: ApiClient;
  courses: readonly AdminCourseSummary[];
  onUploaded: () => void;
}) {
  const [courseSlug, setCourseSlug] = useState("");
  const [rows, setRows] = useState<readonly Progress[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = useCallback(
    async (files: readonly File[]) => {
      if (courseSlug === "" || files.length === 0) return;
      setBusy(true);
      setRows(files.map((file) => ({ name: file.name, percent: 0 })));

      const update = (index: number, change: Partial<Progress>) => {
        setRows((current) =>
          current.map((row, i) => (i === index ? { ...row, ...change } : row)),
        );
      };

      for (const [index, file] of files.entries()) {
        const planned = planFile(file);
        if (!planned.ok) {
          // Refused before a byte is sent. The server refuses too; this is the
          // difference between finding out now and finding out in twenty
          // minutes.
          update(index, { problem: de.media.upload.refused[planned.reason] });
          continue;
        }

        const { purpose, mimeType, sizeBytes, inParts } = planned.plan;

        try {
          if (inParts) {
            await uploadInParts(
              props.client,
              courseSlug,
              file,
              { purpose, mimeType, sizeBytes },
              { onProgress: (percent) => update(index, { percent }) },
            );
          } else {
            const ticket = await props.client.adminBeginUpload(courseSlug, {
              purpose,
              mimeType,
              sizeBytes,
            });
            await uploadToTicket(ticket, file, {
              onProgress: (percent) => update(index, { percent }),
            });
            await props.client.adminCompleteUpload(courseSlug, ticket.key, file.name);
          }
          update(index, { percent: 100, done: true });
        } catch (error) {
          update(index, { problem: describeError(error, de.error.generic) });
        }
      }

      setBusy(false);
      // Whatever landed is in the library now, including a partial batch: the
      // rows above say which failed, and hiding the successes until every file
      // succeeded would be the worse half of both.
      props.onUploaded();
    },
    [courseSlug, props],
  );

  const chooseFiles = (list: FileList | null) => {
    if (list !== null) void send([...list]);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">{de.media.upload.title}</h2>

      <div className="mt-3 max-w-sm">
        <label
          className="block text-xs font-medium text-gray-700"
          htmlFor="ds-media-course"
        >
          {de.media.upload.course}
        </label>
        <Select
          id="ds-media-course"
          value={courseSlug}
          options={[
            ["", de.media.upload.chooseCourse],
            ...props.courses.map(
              (course) => [course.slug, course.title] as readonly [string, string],
            ),
          ]}
          onChange={setCourseSlug}
        />
        <p className="mt-1 text-xs text-gray-500">{de.media.upload.courseHint}</p>
      </div>

      {/*
        A drop target that is also a button.

        The `<input>` stays in the DOM and is what actually opens the picker:
        a div with a click handler is not reachable by keyboard, and an author
        who cannot drag is not a special case.
      */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFiles(event.dataTransfer.files);
        }}
        className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragging ? "border-brand-500 bg-brand-50" : "border-gray-300"
        }`}
      >
        <p className="text-sm text-gray-700">{de.media.upload.drop}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          accept={acceptedMimeTypes().join(",")}
          onChange={(event) => chooseFiles(event.target.files)}
        />
        <div className="mt-3">
          <Button
            variant="secondary"
            disabled={courseSlug === "" || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? de.media.upload.busy : de.media.upload.choose}
          </Button>
        </div>
        {courseSlug === "" ? (
          // §9.4: the control is disabled and this is why, where somebody looks.
          <p className="mt-2 text-xs text-gray-500">{de.media.upload.needCourse}</p>
        ) : null}
      </div>

      {rows.length === 0 ? null : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li key={row.name} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-gray-800">{row.name}</span>
                <span className="shrink-0 text-gray-500">
                  {row.problem !== undefined
                    ? de.media.upload.failed
                    : row.done === true
                      ? de.media.upload.done
                      : `${String(row.percent)} %`}
                </span>
              </div>
              {row.problem === undefined ? (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full ${row.done === true ? "bg-emerald-500" : "bg-brand-500"}`}
                    style={{ width: `${String(row.percent)}%` }}
                  />
                </div>
              ) : (
                <p className="mt-1 text-red-700">{row.problem}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {rows.some((row) => row.problem !== undefined) ? (
        <div className="mt-3">
          <Notice tone="error">{de.media.upload.someFailed}</Notice>
        </div>
      ) : null}
    </section>
  );
}
