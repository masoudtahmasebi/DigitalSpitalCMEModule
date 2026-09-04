/**
 * An SMTP server the harness runs, so the journey can assert that a certificate
 * actually left the building (P187-01).
 *
 * ## The gap this closes
 *
 * `apps/api` has 22 integration tests for certificate delivery and every one of
 * them ends at a fake `DeliveryChannel`: they assert what the service *handed*
 * the channel. Nothing anywhere connected a socket. So the last link of the
 * chain — compose a message, open a connection, negotiate TLS, authenticate,
 * transfer the PDF — was covered by the same amount of test as the CSP header
 * and the bucket CORS rule were before P68 and P70: none, with everything
 * green.
 *
 * That is CLAUDE.md §9.13 exactly. An API test cannot assert that a byte
 * reached a mail server, and "delivered" on a row is not evidence that anything
 * was delivered.
 *
 * ## Why it speaks real SMTP rather than being stubbed
 *
 * `SmtpDeliveryChannel` sets `requireTLS: true`, so nodemailer will refuse to
 * send unless the server offers **STARTTLS** and the upgrade succeeds. A sink
 * that accepted plaintext would model a server nobody runs and would hide the
 * one failure mode that matters here — a mail server that does not offer the
 * upgrade gets an error rather than a plaintext send carrying a physician's
 * name and their Teilnahmebescheinigung.
 *
 * It also demands AUTH, for the same reason `object-store.ts` verifies SigV4:
 * a fixture that accepts anything cannot fail on a credential the product
 * forgot to send. §9.13's second rule — the rig is shaped like the deployment,
 * including the parts the deployment would refuse.
 *
 * The certificate is `tls.ts`'s, which the API already trusts through
 * `NODE_EXTRA_CA_CERTS` for the bucket. One throwaway CA for the whole rig.
 *
 * ## What it does not do
 *
 * It parses no MIME. `messages` holds the raw DATA payload and the envelope,
 * and the assertions grep it — which is the right altitude for a rig: the
 * question is "did the bytes arrive and do they carry the attachment", not
 * "does our MIME encoder agree with a second MIME decoder we also wrote".
 */

import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { TLSSocket, createSecureContext } from "node:tls";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { selfSignedLoopbackCertificate } from "./tls.js";

export interface SinkMessage {
  /** The envelope sender, from `MAIL FROM`. */
  readonly from: string;
  /** Every `RCPT TO` of this transaction. */
  readonly to: readonly string[];
  /** The raw DATA payload, dot-unstuffed, headers and body together. */
  readonly data: string;
  /** Whether the transaction authenticated before `MAIL FROM`. */
  readonly authenticated: boolean;
  /** Whether the transaction was carried over TLS. */
  readonly secure: boolean;
}

export interface MailSink {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  /** Every accepted message, oldest first. */
  readonly messages: readonly SinkMessage[];
  close(): Promise<void>;
}

export const SINK_USERNAME = "ds-harness";
export const SINK_PASSWORD = "harness-smtp-password";

/**
 * Where accepted messages are written, one JSON object per line.
 *
 * The sink runs in Playwright's **runner** process, started by `globalSetup`,
 * and the specs run in workers it spawns afterwards — so the in-memory array
 * cannot be read from a test, for exactly the reason `globalSetup` already
 * records about `globalThis`. A file is the channel, as `api.log` is for the
 * API's output, and it survives the run for whoever is debugging.
 */
export function mailLogPath(repo: string): string {
  return `${repo}apps/e2e/test-results/mail.jsonl`;
}

export async function startMailSink(logPath: string): Promise<MailSink> {
  const certificate = selfSignedLoopbackCertificate();
  const messages: SinkMessage[] = [];

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a harness path built from the repo root
  mkdirSync(dirname(logPath), { recursive: true });
  // Truncated per run: a message left by the previous run would be a green
  // assertion about mail this run never sent (§9.1).
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- as above
  writeFileSync(logPath, "");

  const record = (message: SinkMessage): void => {
    messages.push(message);
    // Synchronous, like `api.log`: the interesting case is a crash, and a
    // queued async write is exactly what does not survive one.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- as above
    appendFileSync(logPath, `${JSON.stringify(message)}\n`);
  };

  const server: Server = createServer((socket) => {
    handleConnection(socket, certificate, record);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    host: "127.0.0.1",
    port,
    username: SINK_USERNAME,
    password: SINK_PASSWORD,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * What the sink has accepted so far, read from the log the runner writes.
 *
 * Answers `[]` for a missing file rather than throwing: "no mail yet" is the
 * normal state at the start of a poll, and a spec waiting for a message should
 * time out saying so rather than fail on ENOENT one line earlier.
 */
export function receivedMail(logPath: string): SinkMessage[] {
  let raw: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a harness path built from the repo root
    raw = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as SinkMessage);
}

/**
 * One connection, as a small state machine over lines.
 *
 * `session` is rebuilt on STARTTLS because RFC 3207 requires the server to
 * discard everything negotiated before the upgrade — a sink that carried an
 * AUTH across it would accept a client that authenticated in plaintext, which
 * is the property the upgrade exists to prevent.
 */
function handleConnection(
  raw: Socket,
  certificate: { key: string; cert: string },
  record: (message: SinkMessage) => void,
): void {
  let socket: Socket = raw;
  let buffer = "";
  let secure = false;
  let authenticated = false;
  let from = "";
  let to: string[] = [];
  let inData = false;
  let data = "";
  /** Set while an `AUTH LOGIN` exchange is waiting for a line of base64. */
  let awaiting: "username" | "password" | undefined;

  const write = (line: string): void => {
    socket.write(`${line}\r\n`);
  };

  const attach = (next: Socket): void => {
    socket = next;
    socket.setEncoding("utf8");
    socket.on("data", onChunk);
    socket.on("error", () => undefined);
  };

  function onChunk(chunk: string | Buffer): void {
    buffer += chunk.toString();
    for (;;) {
      const end = buffer.indexOf("\r\n");
      if (end === -1) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (onLine(line) === "upgraded") return;
    }
  }

  function onLine(line: string): "upgraded" | void {
    if (inData) {
      if (line === ".") {
        inData = false;
        record({ from, to: [...to], data, authenticated, secure });
        from = "";
        to = [];
        data = "";
        write("250 2.0.0 Ok: queued");
        return;
      }
      // Dot-unstuffing, per RFC 5321 §4.5.2. Without it a body line beginning
      // with a period arrives with an extra one and an assertion on the PDF
      // would fail for a reason that is not the product's.
      data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
      return;
    }

    if (awaiting !== undefined) {
      /*
       * Present, not correct. The sink records `authenticated` and the journey
       * asserts it, which is the property that matters here — the product
       * offers a credential at all, and does so only after the TLS upgrade.
       *
       * Checking the value would make this a test of the harness's own
       * constants: the same file chooses the password, `global-setup` exports
       * it, and the spec types it into the console. There is no independent
       * fact for the comparison to establish.
       */
      awaiting = awaiting === "username" ? "password" : undefined;
      if (awaiting === undefined) {
        authenticated = true;
        write("235 2.7.0 Authentication successful");
      } else {
        write("334 UGFzc3dvcmQ6");
      }
      return;
    }

    const [verb = "", ...rest] = line.split(" ");
    const argument = rest.join(" ");

    switch (verb.toUpperCase()) {
      case "EHLO":
      case "HELO":
        write("250-ds-mail-sink");
        // STARTTLS is offered only while the connection is plain: advertising
        // it inside TLS invites a second upgrade, and nodemailer would try.
        if (!secure) write("250-STARTTLS");
        write("250-AUTH PLAIN LOGIN");
        write("250 8BITMIME");
        return;

      case "STARTTLS": {
        write("220 2.0.0 Ready to start TLS");
        socket.removeAllListeners("data");
        const upgraded = new TLSSocket(socket, {
          isServer: true,
          secureContext: createSecureContext({
            key: certificate.key,
            cert: certificate.cert,
          }),
        });
        secure = true;
        // Everything negotiated before the upgrade is discarded (RFC 3207 §4.2).
        authenticated = false;
        buffer = "";
        attach(upgraded as unknown as Socket);
        return "upgraded";
      }

      case "AUTH": {
        if (!secure) {
          // Refused rather than accepted: a product that authenticated in
          // plaintext would pass against a permissive sink and be refused by
          // every real server.
          write("538 5.7.11 Encryption required for requested authentication");
          return;
        }
        const [mechanism = ""] = argument.split(" ");
        if (mechanism.toUpperCase() === "PLAIN") {
          authenticated = true;
          write("235 2.7.0 Authentication successful");
          return;
        }
        awaiting = "username";
        write("334 VXNlcm5hbWU6");
        return;
      }

      case "MAIL":
        if (!authenticated) {
          write("530 5.7.0 Authentication required");
          return;
        }
        from = address(argument);
        write("250 2.1.0 Ok");
        return;

      case "RCPT":
        to.push(address(argument));
        write("250 2.1.5 Ok");
        return;

      case "DATA":
        inData = true;
        write("354 End data with <CR><LF>.<CR><LF>");
        return;

      case "RSET":
        from = "";
        to = [];
        data = "";
        write("250 2.0.0 Ok");
        return;

      case "QUIT":
        write("221 2.0.0 Bye");
        socket.end();
        return;

      default:
        write("250 2.0.0 Ok");
        return;
    }
  }

  attach(raw);
  write("220 ds-mail-sink ESMTP ready");
}

/** `FROM:<a@b>` → `a@b`. */
function address(argument: string): string {
  const start = argument.indexOf("<");
  const end = argument.lastIndexOf(">");
  if (start === -1 || end === -1) return argument.split(":").slice(1).join(":").trim();
  return argument.slice(start + 1, end);
}
