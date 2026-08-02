import { handlePersonalVaultProxy } from "../../../../../../../lib/personal-vault/sync-bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly pairingId: string }> },
): Promise<Response> {
  const { pairingId } = await context.params;
  return handlePersonalVaultProxy(request, "approve-pairing", pairingId);
}
