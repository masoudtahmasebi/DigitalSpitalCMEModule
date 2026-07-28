import { Module } from "@nestjs/common";
import { AssessmentController } from "./assessment.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [AssessmentController] })
export class AssessmentModule {}
