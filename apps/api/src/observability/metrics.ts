/**
 * Prometheus metrics, in about 120 lines and no dependency (P25-01).
 *
 * ## Why not `prom-client`
 *
 * Because what this deployment needs is four metrics and a text endpoint, and
 * the exposition format is a stable, published, line-oriented text format. A
 * client library brings a dependency tree, a registry abstraction and a
 * default-metrics collector for a host that already reports its own — in
 * exchange for saving the histogram bucketing below, which is the only part
 * with any subtlety and is therefore the part worth having tests for.
 *
 * Same reasoning as `s3-presigner.ts`: a specification that can be checked
 * against a fixture is not where a dependency earns its supply-chain surface.
 *
 * ## What is measured, and why these four
 *
 * - **`ds_http_requests_total`** by method, route and status class. Answers
 *   "are we serving errors, and on what".
 * - **`ds_http_request_duration_seconds`** as a histogram. Answers "is it slow",
 *   and a histogram rather than an average because an average hides the tail,
 *   and the tail is what a physician experiences.
 * - **`ds_eiv_submissions_total`** by outcome. A Punktemeldung races an 8-day
 *   statutory window; this is the one number whose drift is a compliance
 *   incident rather than an inconvenience.
 * - **`ds_certificate_deliveries_total`** by outcome, for the same shape of
 *   reason with a lower stake.
 *
 * ## Cardinality is a hard limit, not a guideline
 *
 * A label whose value comes from a request path is a memory leak with extra
 * steps: `/courses/adhs-akademie-adult` as a label value means one time series
 * per course, for ever, in a process that never restarts. The route template is
 * used instead, and `MAX_SERIES` refuses new series past a bound rather than
 * growing without limit — a metrics endpoint that OOMs the API is worse than no
 * metrics at all.
 */

/** Seconds. Chosen for a video platform: the interesting range is 10 ms–5 s. */
const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

/**
 * The ceiling on distinct label combinations.
 *
 * Roughly: 60 routes × 4 status classes × 4 methods. Past it, new combinations
 * are folded into `route="other"` rather than allocated — the metric degrades
 * instead of the process dying.
 */
const MAX_SERIES = 1000;

interface Histogram {
  readonly counts: number[];
  sum: number;
  count: number;
}

export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Histogram>();
  private readonly counters = new Map<string, number>();
  private overflowed = false;

  /**
   * Record one served request.
   *
   * The **status class** (`2xx`, `4xx`, `5xx`) rather than the exact code: the
   * question a dashboard asks is "are we erroring", and 401 versus 403 is a
   * question for the log, which has the correlation id to answer it with.
   */
  observeRequest(
    method: string,
    route: string,
    status: number,
    durationMs: number,
  ): void {
    const key = `${method}|${this.boundRoute(route)}|${Math.floor(status / 100)}xx`;

    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);

    let histogram = this.durations.get(key);
    if (histogram === undefined) {
      histogram = { counts: new Array<number>(BUCKETS.length).fill(0), sum: 0, count: 0 };
      this.durations.set(key, histogram);
    }

    const seconds = durationMs / 1000;
    histogram.sum += seconds;
    histogram.count += 1;
    for (let index = 0; index < BUCKETS.length; index += 1) {
      // Cumulative, as the exposition format requires: bucket `le` counts
      // everything at or below it, not only what falls between two edges.
      if (seconds <= (BUCKETS[index] ?? 0))
        histogram.counts[index] = (histogram.counts[index] ?? 0) + 1;
    }
  }

  /** A named outcome counter: EIV submissions, certificate deliveries. */
  count(name: string, outcome: string): void {
    const key = `${name}|${outcome}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  /**
   * A route that is safe to use as a label.
   *
   * Anything unbounded — a path with an id in it, because no handler matched
   * and the middleware fell back to the raw path — collapses to `other`. One
   * time series per course slug is a leak; one series called `other` is a
   * signal that somebody should add a route.
   */
  private boundRoute(route: string): string {
    if (this.requests.size >= MAX_SERIES) {
      this.overflowed = true;
      return "other";
    }
    // A concrete id or slug where a template was expected.
    return /[0-9a-f]{8}-[0-9a-f]{4}/i.test(route) ? "other" : route;
  }

  /** The Prometheus text exposition format, version 0.0.4. */
  render(): string {
    const lines: string[] = [];

    lines.push("# HELP ds_http_requests_total HTTP requests served.");
    lines.push("# TYPE ds_http_requests_total counter");
    for (const [key, value] of [...this.requests].sort()) {
      lines.push(`ds_http_requests_total${labels(key)} ${value}`);
    }

    lines.push("# HELP ds_http_request_duration_seconds Request duration.");
    lines.push("# TYPE ds_http_request_duration_seconds histogram");
    for (const [key, histogram] of [...this.durations].sort()) {
      const base = labels(key);
      for (let index = 0; index < BUCKETS.length; index += 1) {
        const le = BUCKETS[index] ?? 0;
        lines.push(
          `ds_http_request_duration_seconds_bucket${withLe(base, String(le))} ${histogram.counts[index] ?? 0}`,
        );
      }
      lines.push(
        `ds_http_request_duration_seconds_bucket${withLe(base, "+Inf")} ${histogram.count}`,
      );
      lines.push(
        `ds_http_request_duration_seconds_sum${base} ${histogram.sum.toFixed(6)}`,
      );
      lines.push(`ds_http_request_duration_seconds_count${base} ${histogram.count}`);
    }

    for (const [key, value] of [...this.counters].sort()) {
      const [name = "", outcome = ""] = key.split("|");
      lines.push(`# TYPE ds_${name}_total counter`);
      lines.push(`ds_${name}_total{outcome="${escapeLabel(outcome)}"} ${value}`);
    }

    // Not decoration: a dashboard showing `route="other"` climbing is how
    // anybody finds out the label set has degraded.
    lines.push("# HELP ds_metrics_series_overflow Label cardinality hit its bound.");
    lines.push("# TYPE ds_metrics_series_overflow gauge");
    lines.push(`ds_metrics_series_overflow ${this.overflowed ? 1 : 0}`);

    /*
     * Which commit is answering (P42-03).
     *
     * "The feature is missing" and "the feature is not on the server you are
     * looking at" are indistinguishable from a browser, and the second one has
     * now cost two rounds of investigation. A running system could not be asked
     * what it was built from: the deploy log says `Deployed <sha>` and then
     * scrolls away.
     *
     * **Here and not on `/health`,** which is public — a load balancer cannot
     * present a bearer token. A version string on a public endpoint is a
     * fingerprint that tells anyone which vulnerabilities to try. `/metrics` is
     * `@Public()` in the same sense but is not routed from the edge
     * (`infra/deploy/Caddyfile`), so reaching it needs a place inside the
     * Docker network — which an operator has and the internet does not.
     *
     * One series, constant labels, and the `_info` gauge-at-1 convention that
     * `node_exporter` and `prom-client` both use, so it joins in a dashboard.
     */
    lines.push("# HELP ds_build_info The commit this process was built from.");
    lines.push("# TYPE ds_build_info gauge");
    lines.push(
      `ds_build_info{commit="${escapeLabel(process.env["DS_COMMIT"] ?? "unknown")}"} 1`,
    );

    return `${lines.join("\n")}\n`;
  }
}

function labels(key: string): string {
  const [method = "", route = "", status = ""] = key.split("|");
  return `{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"}`;
}

function withLe(base: string, le: string): string {
  return `${base.slice(0, -1)},le="${le}"}`;
}

/** The three characters the exposition format requires escaping in a value. */
function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}
