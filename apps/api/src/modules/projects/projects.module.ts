import { Module } from "@nestjs/common";
import { BrandingController } from "./branding.controller.js";
import { TenantController } from "./tenant.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [BrandingController, TenantController] })
export class ProjectsModule {}
