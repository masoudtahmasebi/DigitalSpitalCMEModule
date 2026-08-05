/**
 * The customer registry endpoints (P12-04). Interface layer — ADR-0006.
 *
 * ## Why these are `@StaffCapability("customer")` and not `@Roles(...)`
 *
 * `@Roles` resolves a role *within a tenant*, and these routes have no tenant:
 * the whole point of the list is that it spans customers, and creating one
 * brings a tenant into existence rather than acting inside it. There is no
 * `X-DS-Project` header on these requests and therefore no `principal` — only
 * a `staffProfile` (ADR-0012).
 *
 * `customer` is a capability only `super_admin` holds (P12-01b): a customer is
 * the tenant boundary itself, so nobody inside one may mint another. Marking
 * these `@StaffOnly()` instead would make them reachable by every course editor
 * of every customer, which is the exact failure the capability model exists to
 * prevent.
 *
 * ## Why the operator id comes from the session and not the body
 *
 * `staffProfile.id` is set by `AuthGuard` from a validated session. Accepting
 * it as a parameter would let a caller write somebody else's name into the
 * audit trail for the two most consequential operations in the product.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Patch,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { StaffCapability } from "../../auth/staff-only.decorator.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { AppError } from "../../shared/problem-details.js";
import type { CustomerSummary } from "./customer.dto.js";
import { customerCreateSchema, customerUpdateSchema } from "./customer.dto.js";
import { CustomerService, type OperatorContext } from "./customer.service.js";

@Controller("admin/customers")
@StaffCapability("customer")
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get()
  list(): Promise<CustomerSummary[]> {
    return this.service.list();
  }

  @Get(":slug")
  get(@Param("slug") slug: string): Promise<CustomerSummary> {
    return this.service.get(slug);
  }

  @Post()
  @RateLimit("customerCreate")
  create(@Body() body: unknown, @Req() request: Request): Promise<CustomerSummary> {
    return this.service.create(customerCreateSchema.parse(body), operatorOf(request));
  }

  @Patch(":slug")
  update(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CustomerSummary> {
    return this.service.update(
      slug,
      customerUpdateSchema.parse(body),
      operatorOf(request),
    );
  }

  @Delete(":slug")
  @HttpCode(204)
  remove(@Param("slug") slug: string, @Req() request: Request): Promise<void> {
    return this.service.remove(slug, operatorOf(request));
  }
}

function operatorOf(request: Request): OperatorContext {
  const profile = request.staffProfile;
  if (profile === undefined) {
    // RolesGuard has already refused a request without a staff session, so
    // reaching here means the guard order was misconfigured. Fail closed.
    throw AppError.unauthenticated("no staff session on a customer route");
  }
  return { staffUserId: profile.id };
}
