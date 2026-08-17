/**
 * Redis-backed rate limiting (P10-03).
 *
 * Backed by Redis rather than in-process counters because the limit must hold
 * across instances — a per-process counter multiplies the real limit by the
 * number of replicas, which is the same as not having one.
 *
 * ## What is limited, and what deliberately is not
 *
 * The costs worth bounding are the ones an attacker can turn into work or into
 * an attempt: quiz submissions (scoring, and guessing at the answer key),
 * completion (an EIV submission), and EFN writes. Those get tight limits.
 *
 * **Progress heartbeats are deliberately generous.** A 25-minute video
 * reporting every few seconds is a legitimate learner producing hundreds of
 * requests, and throttling them would lose watch data — which, since watch
 * coverage gates a CME point, means punishing a real physician for watching
 * the course properly (P10-03 acceptance criterion).
 *
 * The counter is a fixed window: one `INCR` and one `EXPIRE`, cheap and
 * good enough. A sliding window would smooth the boundary but costs a sorted
 * set per key, and nothing here needs that precision.
 */

export interface RateLimitStore {
  /** Increments the key and returns the new count; sets the TTL on first use. */
  increment(key: string, windowSec: number): Promise<number>;
}

export interface RateLimitRule {
  readonly limit: number;
  readonly windowSec: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSec: number;
}

/**
 * The rules, keyed by a stable name rather than a path, so a route can be
 * renamed without silently losing its limit.
 */
export const RATE_LIMIT_RULES = {
  /** Scoring plus answer-key guessing. The tightest limit in the system. */
  quizSubmit: { limit: 10, windowSec: 60 },
  /** Each one can queue a Punktemeldung. */
  completion: { limit: 5, windowSec: 60 },
  /** Cheap to serve, but a write of personal data. */
  efnWrite: { limit: 10, windowSec: 60 },
  /**
   * The read is separate and far more generous (P57-01).
   *
   * It shared `efnWrite`'s bucket at first, and the completion screen asks on
   * every mount — so a physician reloading the page while correcting a typo
   * spent the same ten-per-minute budget the correction itself needs, and was
   * told to try again later in the middle of fixing the one field that matters.
   * Being throttled out of reading your own identifier is the wrong end of the
   * trade: the read is idempotent, returns one field, and can only ever return
   * the caller's own.
   */
  efnRead: { limit: 60, windowSec: 60 },
  /** Generous on purpose — see the note above. */
  progress: { limit: 600, windowSec: 60 },
  /**
   * Rendering a PDF is the most expensive thing a learner token can ask for:
   * pdf-lib composes the document, embeds two images and draws two barcodes,
   * all on the event loop. A learner legitimately downloads their certificate
   * once, occasionally twice. A loop over this endpoint is a CPU denial of
   * service that requires nothing but a valid token.
   */
  certificatePdf: { limit: 10, windowSec: 60 },
  /**
   * Admin uploads: a font is up to 2 MB and the certificate images 512 KB
   * each, all written to bytea. The role check already limits who can do this,
   * so the limit is about a stuck client or a compromised admin session
   * filling a disk, not about an anonymous attacker.
   */
  adminUpload: { limit: 20, windowSec: 60 },
  /**
   * Course media uploads (P23-01). Separate from `adminUpload`, and higher.
   *
   * Those two limits guard different things and sharing one was wrong for both.
   * `adminUpload` writes bytes into `bytea` through this process, so its limit
   * is about a stuck client filling a disk — 20 a minute is generous for
   * something nobody does twice in a sitting.
   *
   * This one signs a URL. The bytes go straight to the bucket and never touch
   * us, so what the limit protects is not our disk; the size ceiling and the
   * bucket's own quota do that. Meanwhile the legitimate shape is a burst:
   * building a fifteen-lesson course means a video, a poster and a caption file
   * each, and every one of them is two requests. At 20 a minute an author
   * seeding a course hits a 429 partway through and has no idea why — which is
   * exactly the class of thing that gets reported as "the upload is broken".
   *
   * 60 a minute is 30 files, sustained, which no person does and which leaves
   * a batch comfortable.
   */
  mediaUpload: { limit: 60, windowSec: 60 },
  /**
   * Participant sign-in (P25-02). The tightest limit in the platform.
   *
   * It is the **only unauthenticated write on the learner plane**, so it is the
   * only door an online guessing attack can knock on. Five a minute is more
   * than a person typing a password wrong needs and far less than a script
   * wants; `learner_credentials.locked_until` is the second line behind it, in
   * the database rather than in Redis so a container restart does not clear it.
   */
  participantSignIn: { limit: 5, windowSec: 60 },
  /**
   * Creating a participant, or resetting one's password (P21-04).
   *
   * Both mint a credential, and the limit is about a compromised or careless
   * *staff* session rather than an anonymous attacker — the role check already
   * decided who may be here. Thirty a minute leaves an administrator onboarding
   * a department comfortable, and stops a loop in a console script creating
   * five hundred accounts that then have to be found and disabled one by one.
   */
  participantCreate: { limit: 30, windowSec: 60 },
  /**
   * Asking for a password-reset link, on either plane (P40-02).
   *
   * Unauthenticated, and it *sends mail to an address the caller chose*, so it
   * is two abuse surfaces at once: an enumeration probe and a way to have the
   * platform mail somebody repeatedly. Three a minute per IP is more than a
   * person who mistyped their address needs and stops both.
   *
   * The endpoint answers 202 regardless, so a 429 here is the only observable
   * difference between callers — which is why the limit is on the IP and not
   * on the address: keying it on the address would answer "this address is
   * being asked about a lot", and that is the question the flow refuses.
   */
  staffPasswordReset: { limit: 3, windowSec: 60 },
  /**
   * The platform sender's own test message (P77-01).
   *
   * A button that makes the server send mail is an outbound channel, and an
   * unlimited one is a way to have this platform's relay send a few thousand
   * messages to a super administrator's inbox — which costs the relay's
   * reputation, which is the whole asset the sender depends on.
   *
   * Deliberately generous per minute and small enough to be useless as a
   * cannon: somebody wiring up SMTP legitimately presses this a handful of
   * times while they fix a host name, and nobody legitimately presses it fifty
   * times a minute.
   */
  platformMailTest: { limit: 5, windowSec: 60 },
  /**
   * A participant changing their own password.
   *
   * Tight, because the endpoint takes the *current* password: without a limit
   * it is a second guessing oracle, reachable with a stolen session rather than
   * with no credential at all. Ten a minute is far more than somebody mistyping
   * needs.
   */
  participantPasswordChange: { limit: 10, windowSec: 60 },
  /**
   * A participant export is where personal data leaves the system's access
   * controls entirely. Every one of them is audited (P9-07); a limit is what
   * keeps that audit trail a record of deliberate acts rather than of a script.
   */
  adminExport: { limit: 10, windowSec: 60 },
  /**
   * Creating a customer mints a tenant boundary. Nobody legitimately does it in
   * bulk, and an accidental loop in a console script should stop rather than
   * seed fifty empty tenants that then have to be found and deleted one by one.
   */
  customerCreate: { limit: 10, windowSec: 60 },
  /**
   * Creating an operator account (P64-01).
   *
   * Split out of `customerCreate`, which it used to share. The two are not the
   * same act: creating a customer mints a tenant boundary and nobody does it in
   * bulk, while onboarding a department's operators is a dozen accounts in a
   * few minutes and is exactly what this screen is for. Sharing one bucket of
   * ten meant a legitimate onboarding ran out, and refused the eleventh person
   * for a reason about customers.
   */
  staffCreate: { limit: 30, windowSec: 60 },
  /**
   * Setting an operator's password (P64-01).
   *
   * Its own bucket, not `customerCreate`, and the reason is worth stating: they
   * are different acts with different volumes. An administrator onboarding a
   * team sets several passwords in a minute and creates no customers, and a
   * shared bucket made the two starve each other — which showed up first as
   * *unrelated* tests failing with 429, several cases after the ones that spent
   * it.
   *
   * Not the sign-in limiter either. There, a limit is a security control
   * against guessing; here the caller is already an authenticated administrator
   * whom `canGrant` has already permitted, and the limit only stops a script
   * from running away.
   */
  staffPasswordSet: { limit: 30, windowSec: 60 },
  /**
   * Erasing a subject is irreversible, cross-tenant, and something an operator
   * does a handful of times a year. There is no version of "erase fifty
   * subjects quickly" that is not either a mistake or an attack.
   */
  subjectErasure: { limit: 5, windowSec: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMIT_RULES;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: {
      incr(key: string): Promise<number>;
      expire(key: string, seconds: number): Promise<unknown>;
    },
  ) {}

  async increment(key: string, windowSec: number): Promise<number> {
    const count = await this.redis.incr(key);
    // Only the first increment in a window sets the expiry; refreshing it on
    // every hit would let a steady stream of requests keep the window open
    // forever and never reset the count.
    if (count === 1) await this.redis.expire(key, windowSec);
    return count;
  }
}

export class RateLimiter {
  constructor(private readonly store: RateLimitStore) {}

  /**
   * `subject` is the user id where one is known, and the client IP otherwise.
   * Keying on the user is what stops one learner's quota being consumed by
   * another behind the same hospital NAT.
   */
  async check(
    name: RateLimitName,
    subject: string,
    now: Date,
  ): Promise<RateLimitDecision> {
    const rule = RATE_LIMIT_RULES[name];
    const window = Math.floor(now.getTime() / 1000 / rule.windowSec);
    const key = `ratelimit:${name}:${subject}:${window}`;

    const count = await this.store.increment(key, rule.windowSec);
    const allowed = count <= rule.limit;

    // Seconds until this fixed window rolls over.
    const retryAfterSec = allowed
      ? 0
      : (window + 1) * rule.windowSec - Math.floor(now.getTime() / 1000);

    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSec,
    };
  }
}
