import { handleCatalogProxy } from "../../../../lib/catalog/bff";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleCatalogProxy(request, "sessions");
}
