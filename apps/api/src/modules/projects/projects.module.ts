import { Module } from "@nestjs/common";
import { BrandingController } from "./branding.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [BrandingController] })
export class ProjectsModule {}
