import { Module } from "@nestjs/common";
import { CertificateController } from "./certificate.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [CertificateController] })
export class CertificateModule {}
