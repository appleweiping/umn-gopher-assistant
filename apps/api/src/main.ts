import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module.js";

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "4000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    bodyLimit: 1_048_576,
    ignoreTrailingSlash: false,
    requestIdHeader: "x-request-id",
    trustProxy: process.env["TRUST_PROXY"] === "true",
  });
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
