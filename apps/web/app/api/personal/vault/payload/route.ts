import { handlePersonalVaultProxy } from "../../../../../lib/personal-vault/sync-bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function PUT(request: Request): Promise<Response> {
  return handlePersonalVaultProxy(request, "update-payload");
}
