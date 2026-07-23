import { handleAiQueryProxy } from "../../../../lib/ai/bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAiQueryProxy(request);
}
