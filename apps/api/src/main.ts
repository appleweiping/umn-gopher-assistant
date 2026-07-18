import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module.js";
import { createFastifyAdapter } from "./http/fastify-adapter.js";
import { parsePort } from "./runtime-config.js";

async function bootstrap(): Promise<void> {
  const adapter = createFastifyAdapter();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.enableCors({
    credentials: true,
    origin: process.env["WEB_ORIGIN"] ?? "http://localhost:3000",
  });
  app.enableShutdownHooks();

  const host = process.env["HOST"] ?? "0.0.0.0";
  const port = parsePort(process.env["PORT"]);
  await app.listen({ host, port });
  Logger.log(`Campus API listening on ${host}:${String(port)}`, "Bootstrap");
}

void bootstrap();
