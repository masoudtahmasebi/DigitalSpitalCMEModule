import { Module } from "@nestjs/common";
import { CompletionController } from "./completion.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [CompletionController] })
export class CompletionModule {}
