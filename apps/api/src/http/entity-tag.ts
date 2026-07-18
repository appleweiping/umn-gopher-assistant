import { createHash } from "node:crypto";

export function createEntityTag(value: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("base64url");
  return `"${digest}"`;
}
