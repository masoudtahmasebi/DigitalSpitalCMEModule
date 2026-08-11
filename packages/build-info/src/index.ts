/**
 * Which build am I looking at, and does it match the API's? (P46-01)
 *
 * ## Why this package exists
 *
 * "The feature is missing" and "the feature is not on the server you are
 * looking at" are indistinguishable from a browser, and on this project the
 * second has been the more common of the two — forgot-password was reported
 * absent three times while built, tested and merged (CLAUDE.md §9.9). Every
 * one of those cost a round trip through somebody with SSH.
 *
 * So each frontend shows its own commit beside the API's, and the question is
 * answered by looking.
 *
 * ## Why it is a package rather than a function in each app
 *
 * The console and the portal both need it and neither owns it, which is the
 * same reason `@ds/oidc` exists. The interesting part is not the string
 * formatting — it is `compareBuilds`, and a **version skew is exactly the
 * condition worth naming**: a frontend serving an older bundle than the API it
 * calls is how a green deploy still shows a missing feature, and two copies of
 * that comparison would eventually disagree about what counts as skewed.
 *
 * Pure, like `@ds/domain`: no I/O, no clock. The caller fetches `/health` and
 * passes what it got.
 */

/**
 * `DS_COMMIT` was not set — a local `pnpm dev`, or a container started by hand.
 *
 * A distinct value rather than an empty string, because "I do not know which
 * build this is" and "this build is called nothing" want different words on
 * screen, and an empty string in a footer reads as a rendering bug.
 */
export const UNKNOWN_BUILD = "unknown";

export type BuildAgreement =
  /** Both known, and equal. The ordinary state of a healthy deployment. */
  | "match"
  /** Both known, and different. Somebody deployed half of something. */
  | "skew"
  /** At least one side did not say. Not a problem — just not an answer. */
  | "unknown";

export interface BuildComparison {
  readonly agreement: BuildAgreement;
  /** Short forms, ready to render. */
  readonly frontend: string;
  readonly api: string;
}

/**
 * What a person reads: `v1.0.482 · 0a177c7` (P47-01).
 *
 * Both, and in that order. The version is the half that can be compared —
 * "is this newer than what I saw yesterday" is unanswerable from a SHA — and
 * the commit is the half that identifies the build exactly, which is what you
 * need to `git checkout` it or find its image.
 *
 * The version alone when there is no commit, the commit alone when there is no
 * version, and `unknown` when there is neither. A footer reading
 * `vunknown · unknown` is noise where a single word is the whole message.
 */
export function describeBuild(
  version: string | undefined,
  commit: string | undefined,
): string {
  const release =
    version === undefined || version.trim() === "" ? undefined : version.trim();
  const build = shortCommit(commit);

  if (release === undefined || release === UNKNOWN_BUILD) return build;
  if (build === UNKNOWN_BUILD) return `v${release}`;
  return `v${release} · ${build}`;
}

/**
 * Trim a commit to the length a person can compare at a glance.
 *
 * Seven characters, as `git log --oneline` and `deploy.sh`'s image tags use —
 * the point is that the value in the footer is *the same string* somebody sees
 * in `docker images` and in the deploy log. A different length would make two
 * representations of one fact that do not look alike.
 *
 * Anything that is not a hex commit is passed through unchanged: `unknown` must
 * survive, and so must a tag somebody deploys by hand.
 */
export function shortCommit(commit: string | undefined): string {
  if (commit === undefined || commit.trim() === "") return UNKNOWN_BUILD;
  const trimmed = commit.trim();
  return /^[0-9a-f]{7,40}$/iu.test(trimmed) ? trimmed.slice(0, 7) : trimmed;
}

/**
 * Do the bundle in this browser and the API answering it come from one commit?
 *
 * `unknown` on either side is **not** skew. A developer running `pnpm dev`
 * against a containerised API has no frontend commit at all, and a footer that
 * cried version-skew at them every day is a footer nobody reads by the end of
 * the week — which is the same failure as a warning that always fires.
 */
export function compareBuilds(
  frontendCommit: string | undefined,
  apiCommit: string | undefined,
): BuildComparison {
  const frontend = shortCommit(frontendCommit);
  const api = shortCommit(apiCommit);

  if (frontend === UNKNOWN_BUILD || api === UNKNOWN_BUILD) {
    return { agreement: "unknown", frontend, api };
  }
  return { agreement: frontend === api ? "match" : "skew", frontend, api };
}

export interface ApiBuild {
  readonly version: string;
  readonly commit: string;
}

/**
 * Ask the API which build it is.
 *
 * `/health` and not a route of its own: it is already public, already routed by
 * the edge, and already what `deploy.sh` curls. Adding a second public endpoint
 * for two fields this one can carry would be another thing to expose and review.
 *
 * Both fields in one call rather than two functions over the same request —
 * `version` and `commit` are two halves of one answer and always wanted
 * together, and a second fetch would double the traffic a public footer
 * generates for no gain.
 *
 * Never throws. This is a diagnostic in a footer, and an API that is down is
 * exactly when somebody is reading it: a rejected promise that took the page
 * with it would remove the one element that could have explained why.
 */
export async function fetchApiBuild(apiBase: string): Promise<ApiBuild> {
  const absent: ApiBuild = { version: UNKNOWN_BUILD, commit: UNKNOWN_BUILD };

  try {
    const response = await fetch(`${apiBase.replace(/\/+$/u, "")}/health`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return absent;

    const body: unknown = await response.json();
    return { version: readString(body, "version"), commit: readString(body, "commit") };
  } catch {
    return absent;
  }
}

/**
 * One field of the health body, or `unknown`.
 *
 * An API built before these fields existed omits them entirely, which is
 * precisely the deployment this feature is for — so a missing field is a
 * first-class answer rather than a parse failure.
 */
function readString(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null || !(key in body)) return UNKNOWN_BUILD;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : UNKNOWN_BUILD;
}
