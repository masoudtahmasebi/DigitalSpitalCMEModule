import { Module } from "@nestjs/common";
import { UploadController } from "./upload.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [UploadController] })
export class UploadModule {}
