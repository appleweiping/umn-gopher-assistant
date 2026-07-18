export function parsePort(value: string | undefined): number {
  const candidate = value ?? "4000";
  if (!/^[0-9]+$/u.test(candidate)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const port = Number(candidate);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}
