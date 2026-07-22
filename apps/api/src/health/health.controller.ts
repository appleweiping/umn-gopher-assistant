import { Controller, Get, Header } from "@nestjs/common";

import { Public } from "../auth/auth.decorators.js";
import { HealthService, type HealthStatus } from "./health.service.js";

@Controller("v1/health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @Public()
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }
}
