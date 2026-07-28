import { Module } from "@nestjs/common";
import { AuthoringController } from "./authoring.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [AuthoringController] })
export class AuthoringModule {}
