import { Module } from "@nestjs/common";
import { UploadController } from "./upload.controller.js";
import { PublicMediaController } from "./public-media.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [UploadController, PublicMediaController] })
export class UploadModule {}
