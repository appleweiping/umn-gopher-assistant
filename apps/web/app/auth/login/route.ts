import { authHeaders, authProblem, webAuthRouteContext } from "../../../lib/auth/route-support";
import { startLogin, WebAuthFlowError } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await webAuthRouteContext();
    const result = await startLogin(request, context.runtime, context.store);
    const headers = authHeaders({ Location: result.location.toString(), Pragma: "no-cache" });
    headers.append("Set-Cookie", result.setCookie);
    return new Response(null, { headers, status: 302 });
  } catch (error) {
    return authProblem(error instanceof WebAuthFlowError ? 400 : 503);
  }
}
