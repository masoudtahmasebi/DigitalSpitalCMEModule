/**
 * Wires the catalog feature. `CatalogController` is an ordinary singleton —
 * `CatalogService` and `CatalogRepository` are plain classes it constructs
 * per request from the tenant-scoped `Db`, not Nest providers. See
 * `db/tenant-db.decorator.ts` for why request-scoped DI is deliberately not
 * used here.
 */

import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.js";

@Module({ controllers: [CatalogController] })
export class CatalogModule {}
