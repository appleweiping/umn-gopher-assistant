export const LOCAL_DATABASE_URL = "postgres://gopher:local-postgres-password-only@127.0.0.1:5432/gopher";

export function resolveDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return environment["DATABASE_URL"] ?? LOCAL_DATABASE_URL;
}
