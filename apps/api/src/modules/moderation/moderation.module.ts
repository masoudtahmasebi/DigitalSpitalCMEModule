/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */

import { Module } from "@nestjs/common";
import { ModerationController } from "./moderation.controller.js";

@Module({ controllers: [ModerationController] })
export class ModerationModule {}
