# Observability — finding out what happened

Every production bug in this project so far has been diagnosed from a
screenshot of somebody's browser DevTools. This is the machinery that replaces
that.

Introduced by **P25-01**.

---

## 1. The thirty-second version

```bash
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy

# Everything, live
./dsc logs -f api

# Only failures
./dsc logs api | jq 'select(.level == "error")'

# One request, end to end — paste the id from the browser's network tab
./dsc logs api | jq 'select(.correlationId == "09ffcf0b-798a-43d1-a50a-8d443e7caadc")'

# Everything one customer saw in this container's lifetime
./dsc logs api | jq 'select(.customerId == "0198f4c1-…")'

# Slowest requests
./dsc logs api | jq 'select(.durationMs > 1000) | {route, durationMs, status}'
```

Every line is one JSON object. Nothing is coloured, nothing spans two lines,
and nothing needs a log shipper.

---

## 2. The correlation id

**Every response carries `X-Request-Id`**, success or failure, and the same
value appears on every log line the request produced _and_ in the
`correlationId` of any problem document the client received.

That is the whole point. When somebody reports a problem, the useful thing to
ask for is that id — from the network tab, or from the error the console
showed them — and it turns into the complete story of the request:

```json
{"at":"…","level":"warn","msg":"refused","correlationId":"09ffcf0b-…","kind":"unauthenticated","method":"GET","route":"/courses","reason":"no bearer token presented"}
{"at":"…","level":"info","msg":"request","correlationId":"09ffcf0b-…","method":"GET","route":"/courses","status":401,"durationMs":1}
```

### It used to exist and it did not work

A correlation id was minted **inside the error filter**. It identified the
error and nothing else: there was no access-log line carrying it, no record of
what was asked for, which tenant it was, or how long it ran before failing. The
id a user quoted matched exactly one line — the failure itself, with no context
around it.

The id is now minted at the edge, in middleware, before the guards. That
matters because the requests that have needed diagnosing here are precisely the
ones that fail _in_ a guard: 401s, tenant-header problems, CSRF refusals.

### A caller can supply one

`X-Request-Id` on the way in is honoured, so a trace can span the WordPress
plugin and the API. It is **sanitised, never used raw** — a value with a
newline in it is a forged log line, and one with 40 KB in it is a log file
somebody else paid for. Anything that does not look like an id is replaced.

---

## 3. Nothing personal reaches a log

`docs/gdpr.md` §7 claims no personal data is written to application logs. That
claim used to rest on everybody remembering. It now rests on
`apps/api/src/observability/redact.ts`, which every line passes through —
message and fields alike.

It matches on the **shape of a value**, not on field names, because the
failure is always the unlabelled one:

| What                       | Caught how                                      |
| -------------------------- | ----------------------------------------------- |
| EFN                        | exactly 15 digits, bounded on both sides        |
| E-mail                     | address shape, plus `?email=` in a query string |
| Name, evaluation answers   | by key — a name has no shape to match           |
| Bearer token, JWT          | shape                                           |
| Presigned URL              | `X-Amz-Signature` anywhere in a URL             |
| Password, KMS key          | assignment shape, including `SECRETS_KMS_KEY=`  |
| Connection-string password | userinfo, keeping the user and host             |

Some of that is deliberately blunt. Any 15-digit number is redacted, which
catches identifiers that are not EFNs — a VNR in a log is unhelpful, an EFN in
a log is a reportable incident, and that is not a close call.

Some of it is deliberately **not** blunt. `redactText("no Bearer token
presented")` returns that string unchanged: an earlier version required only
one character after `Bearer` and turned the one message that explains a 401
into `no Bearer [redacted:bearer]`. A redactor that mangles ordinary prose is
one people stop reading the logs because of. It was found by running the API,
not by a test — and there is a test for it now.

---

## 4. Health probes

| Endpoint        | Asks                      | Touches Postgres |
| --------------- | ------------------------- | ---------------- |
| `/health/live`  | is the process wedged?    | **no**           |
| `/health/ready` | should traffic come here? | yes, 503 if not  |
| `/health`       | the original, unchanged   | yes, always 200  |

The split matters. Liveness must **not** depend on the database: a database
outage that failed liveness would restart every API container in a loop,
turning a recoverable dependency failure into a self-inflicted outage that
continues after the database recovers.

Readiness answers with a real **503**. The old `/health` returned
`{"status":"degraded"}` with a 200, and a 200 is a 200 to every load balancer
ever written.

---

## 5. Metrics

`GET /metrics`, Prometheus text format, no dependency.

```
ds_http_requests_total{method,route,status}          counter, status is 2xx/4xx/5xx
ds_http_request_duration_seconds{method,route,status} histogram
ds_eiv_submissions_total{outcome}                    counter
ds_certificate_deliveries_total{outcome}             counter
ds_metrics_series_overflow                           gauge, 0 or 1
```

**Not routed from the edge.** `infra/deploy/Caddyfile` does not expose
`/metrics`, so it is reachable only from inside the Docker network — an
external scraper needs an SSH tunnel. That is the right default for one host;
a fleet would want an allow-list instead.

### Cardinality is a hard limit

A route label taken from a request path is a memory leak with extra steps: one
time series per course slug, for ever, in a process that never restarts. Routes
are matched templates (`/courses/:slug`), anything carrying a concrete id
collapses to `route="other"`, and past 1000 series everything does. The
`ds_metrics_series_overflow` gauge is how anybody finds out that happened.

### The one to alert on

```promql
increase(ds_eiv_submissions_total{outcome="failed"}[1h]) > 0
```

A Punktemeldung races an 8-day statutory window. That is the one number whose
drift is a compliance incident rather than an inconvenience.

---

## 6. What is deliberately not here

- **No log shipper, no Loki, no ELK.** One host, `journalctl` and `jq`. The
  format is ingestible by any of them the day there is a reason.
- **No tracing.** One API process and one database; a span tree would tell you
  what `durationMs` already does.
- **No alerting rules.** `ALERT_WEBHOOK_URL` already posts EIV deadline alarms,
  and `infra/deploy/backup.timer` has `OnFailure=` hooks. Wiring those to a
  pager is a deployment decision, not a code one.
- **No `stack` in a log by default.** A stack quotes source lines, and in this
  codebase those include SQL. Unhandled errors log theirs in a named field,
  redacted with everything else.

---

## 7. Turning up the detail during an incident

```bash
# In ~/ds-education/config.env
LOG_LEVEL=debug

cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./dsc up -d api          # a restart, not a deploy
```

Put it back to `info` afterwards. `debug` is not dangerous — everything is
still redacted — but it is a lot of lines.
