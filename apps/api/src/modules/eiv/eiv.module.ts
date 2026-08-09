import { Module } from "@nestjs/common";
import { EivScheduler } from "./eiv.scheduler.js";
import { EivAdminController } from "./eiv-admin.controller.js";

/**
 * The submission queue has no learner-facing surface — a physician never asks
 * this platform about a Punktemeldung, they ask their Kammer.
 *
 * `EivAdminController` is the operator's surface (P31-02): checking a VNR
 * before a course goes live, reconciling against what the Kammer holds,
 * requeueing an abandoned submission and withdrawing a reported one.
 */
@Module({ controllers: [EivAdminController], providers: [EivScheduler] })
export class EivModule {}
