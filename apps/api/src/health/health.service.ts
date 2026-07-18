import { Injectable } from "@nestjs/common";

export interface HealthStatus {
  readonly status: "ok";
  readonly service: "campus-api";
  readonly version: string;
  readonly time: string;
}

@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return {
      status: "ok",
      service: "campus-api",
      version: process.env["npm_package_version"] ?? "0.1.0",
      time: new Date().toISOString(),
    };
  }
}
