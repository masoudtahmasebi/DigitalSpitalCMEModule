import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { DbModule } from "./db/db.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { TenantTransactionInterceptor } from "./db/tenant-transaction.interceptor.js";
import { ProblemDetailsFilter } from "./shared/problem-details.filter.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { LearningModule } from "./modules/learning/learning.module.js";
import { AssessmentModule } from "./modules/assessment/assessment.module.js";
import { CompletionModule } from "./modules/completion/completion.module.js";
import { EivModule } from "./modules/eiv/eiv.module.js";
import { CertificateModule } from "./modules/certificate/certificate.module.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { JsonLogger } from "./observability/logger.js";
import { AuthoringModule } from "./modules/authoring/authoring.module.js";
import { UploadModule } from "./modules/uploads/upload.module.js";
import { ParticipantAuthModule } from "./modules/participant-auth/participant-auth.module.js";
import { ParticipantModule } from "./modules/participants/participant.module.js";
import { CustomerModule } from "./modules/customers/customer.module.js";
import { ModerationModule } from "./modules/moderation/moderation.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";

@Module({
  imports: [
    DbModule,
    AuthModule,
    HealthModule,
    CatalogModule,
    LearningModule,
    ObservabilityModule,
    AssessmentModule,
    CompletionModule,
    EivModule,
    CertificateModule,
    AdminModule,
    AuthoringModule,
    UploadModule,
    ParticipantAuthModule,
    ParticipantModule,
    CustomerModule,
    ModerationModule,
    ProjectsModule,
  ],
  providers: [
    // Runs after AuthGuard/RolesGuard (guards execute before interceptors in
    // Nest's pipeline), so request.principal is already set when this opens
    // the RLS transaction.
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    // `useFactory`, not `useClass`: the filter takes the shared JsonLogger, and
    // type-based injection is not used anywhere in this application — see
    // `identity-provider.boot-check.ts` for the esbuild/`emitDecoratorMetadata`
    // reason it silently produces `undefined` under `tsx`.
    {
      provide: APP_FILTER,
      useFactory: (logger: JsonLogger) => new ProblemDetailsFilter(logger),
      inject: [JsonLogger],
    },
  ],
})
export class AppModule {}
