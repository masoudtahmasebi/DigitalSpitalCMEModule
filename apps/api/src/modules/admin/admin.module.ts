import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [AdminController] })
export class AdminModule {}
