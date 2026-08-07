import { Module } from "@nestjs/common";
import { HealthController, MetricsController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

// `Metrics` is not provided here: `ObservabilityModule` is `@Global`, and the
// registry has to be the *same instance* the request middleware writes to. A
// second provider would give this controller its own empty one — a metrics
// endpoint that always reports zero, which is worse than none because it looks
// like the system is idle.
@Module({
  controllers: [HealthController, MetricsController],
  providers: [HealthService],
})
export class HealthModule {}
