import { Controller, Get, Header } from "@nestjs/common";

import { HealthService, type HealthStatus } from "./health.service.js";

@Controller("v1/health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }
}
