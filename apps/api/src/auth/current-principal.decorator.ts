import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "./principal.js";

/**
 * Injects the resolved `Principal` into a handler. `AuthGuard` is what sets
 * `request.principal` — this decorator only reads it, never resolves identity
 * itself, so there is exactly one place identity is decided.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.principal;
  },
);
