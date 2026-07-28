import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route as reachable without authentication (e.g. `/health`).
 *
 * `CLAUDE.md` §4 / P1-04: an endpoint with no explicit role decorator is
 * unreachable by default. `@Public()` is the one explicit opt-out, so a route
 * is never accidentally exposed by omission.
 */
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
