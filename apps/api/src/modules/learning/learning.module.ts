import { Module } from "@nestjs/common";
import { LearningController } from "./learning.controller.js";

/**
 * Controllers only — the service and repository are constructed per request
 * from the tenant-scoped `Db` via `LearningService.fromDb`, not by Nest. See
 * CONTRIBUTING.md for why request-scoped providers do not work here.
 */
@Module({ controllers: [LearningController] })
export class LearningModule {}
