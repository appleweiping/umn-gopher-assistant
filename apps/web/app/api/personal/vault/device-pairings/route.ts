import { handlePersonalVaultProxy } from "../../../../../lib/personal-vault/sync-bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handlePersonalVaultProxy(request, "list-pairings");
}

export function POST(request: Request): Promise<Response> {
  return handlePersonalVaultProxy(request, "create-pairing");
}
