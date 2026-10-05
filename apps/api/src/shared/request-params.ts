/**
 * The two shapes a value outside a body can take that our queries cannot
 * (P250-03).
 *
 * ## What went wrong without this
 *
 * Measured on 05.10.2026 with `not-a-uuid` in the path: twenty-six admin
 * routes passed it straight to a query and answered **500** from the driver's
 * `invalid input syntax for type uuid` (twenty-two reached with a customer
 * administrator's token, two participant routes, two staff-account routes).
 * The other five id routes on the same controllers happened to answer 404,
 * 409 or 422 for reasons unrelated to the id, and take the pipe too, so the
 * answer does not depend on which check a handler reaches first. Three list
 * routes read a query parameter as `string | undefined`; Express hands over
 * an **array** when it is repeated (`?q=a&q=b`), which also became a 500.
 * Both are the caller's mistake. A 500 says it is ours, hides what the
 * caller could fix, and counts towards the error rate the alerting watches.
 *
 * ## Why pipes, and why 400
 *
 * `ProblemDetailsFilter` already maps Nest's `HttpException` — "thrown by
 * pipes, e.g. a malformed route param" — to a problem document by status, with
 * Nest's own client-safe message. So the refusal is a 400 problem document
 * naming what was expected and never the value (§9.5), and it happens before
 * the handler, the tenant transaction or any query is reached.
 *
 * 400 rather than the 422 a body refusal gets: the request itself is
 * malformed — an address that cannot name anything, a parameter given twice —
 * as opposed to a well-formed body whose content the rules refuse.
 *
 * The learner routes taking `:contentId` and the public `GET /media/:id`
 * already answer 404 for a malformed id, deliberately, and are left alone.
 */

import {
  BadRequestException,
  Injectable,
  ParseUUIDPipe,
  type ArgumentMetadata,
  type PipeTransform,
} from "@nestjs/common";

/** `@Param("id", UuidParam)` — 400 for anything that is not a uuid. */
export const UuidParam = new ParseUUIDPipe();

/**
 * `@Query("q", SingleQueryValue)` — a query parameter given at most once.
 *
 * Absent stays `undefined`; one value passes through as the string it is;
 * a repeated parameter (an array) or a bracketed one (`?q[a]=b`, an object) is
 * refused, naming the parameter.
 */
@Injectable()
export class SingleQueryValuePipe implements PipeTransform<unknown, string | undefined> {
  transform(value: unknown, metadata: ArgumentMetadata): string | undefined {
    if (value === undefined || typeof value === "string") return value;
    throw new BadRequestException(
      `query parameter ${metadata.data ?? ""} must be given at most once`,
    );
  }
}

export const SingleQueryValue = new SingleQueryValuePipe();
