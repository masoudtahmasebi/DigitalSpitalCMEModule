/**
 * A throwaway certificate for the harness's own bucket (P68-02).
 *
 * ## Why the harness needs one
 *
 * The portal's deployed CSP is `media-src 'self' https:`, and the journey suite
 * now runs under the deployed policy rather than under none (`csp.ts`). A local
 * bucket on plain HTTP would be refused by that policy — correctly — so the
 * harness serves its bucket over TLS instead of relaxing the rule for the test.
 *
 * ## Why it is generated rather than committed
 *
 * A private key in the repository is a gitleaks finding, and it would be a
 * correct one: the scanner cannot tell a test key from a real one, and neither
 * can a person skimming a diff. P33-02 was two self-inflicted findings of
 * exactly that shape. Generated per run, into a temporary directory, it never
 * touches the tree.
 *
 * ## What trusts it, and what that does not weaken
 *
 * Two parties: the API, through `NODE_EXTRA_CA_CERTS`, so `verifyUpload` can
 * HEAD the object it just approved; and the browser, through Playwright's
 * `ignoreHTTPSErrors`. Neither changes how a Content-Security-Policy is
 * evaluated — the scheme in `media-src https:` is matched on the URL, not on
 * the certificate — so the property under test is untouched.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LoopbackCertificate {
  readonly key: string;
  readonly cert: string;
  /** The same certificate on disk — `NODE_EXTRA_CA_CERTS` takes a path. */
  readonly caFile: string;
}

let cached: LoopbackCertificate | undefined;

export function selfSignedLoopbackCertificate(): LoopbackCertificate {
  if (cached !== undefined) return cached;

  const directory = mkdtempSync(join(tmpdir(), "ds-e2e-tls-"));
  const keyFile = join(directory, "bucket.key");
  const certFile = join(directory, "bucket.crt");

  /*
   * openssl rather than a Node library: the platform has no certificate
   * dependency and adding one for a test fixture is supply-chain surface for
   * something the operating system already ships. If it is ever missing, the
   * message says what to install rather than failing later as a TLS handshake
   * error nobody can place.
   */
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      "the e2e harness could not generate a certificate for its object store.\n" +
        "It shells out to `openssl`, which this machine appears not to have.\n" +
        `openssl said: ${result.stderr ?? ""}`,
    );
  }

  cached = {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path this function just created
    key: readFileSync(keyFile, "utf8"),
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path this function just created
    cert: readFileSync(certFile, "utf8"),
    caFile: certFile,
  };
  return cached;
}
