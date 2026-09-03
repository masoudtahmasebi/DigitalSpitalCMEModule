/**
 * Installation-wide settings (P180-01).
 *
 * No providers of its own: the controller builds its repository and service per
 * request from the side pool, the same shape the moderation and customer
 * modules use. There is nothing here to hold between requests — the settings
 * live in one database row, deliberately, so that the console and the worker
 * read the same value at the moment each needs it rather than a copy taken at
 * boot.
 */

import { Module } from "@nestjs/common";
import { PlatformController } from "./platform.controller.js";

@Module({ controllers: [PlatformController] })
export class PlatformModule {}
