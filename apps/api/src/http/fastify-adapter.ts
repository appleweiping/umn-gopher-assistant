import { FastifyAdapter } from "@nestjs/platform-fastify";

export function createFastifyAdapter(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id",
    routerOptions: { ignoreTrailingSlash: false },
    trustProxy: environment["TRUST_PROXY"] === "true",
  });
}
