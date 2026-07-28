import { Module } from "@nestjs/common";
import { EivScheduler } from "./eiv.scheduler.js";

/**
 * No controller: the submission queue has no learner-facing surface. Admin
 * triage of failed submissions is P9, and reads the same rows.
 */
@Module({ providers: [EivScheduler] })
export class EivModule {}
