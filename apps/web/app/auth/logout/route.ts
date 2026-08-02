import { authProblem, authRedirect, webAuthRouteContext } from "../../../lib/auth/route-support";
import { endAuthSession, WebAuthFlowError } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await webAuthRouteContext();
    const result = await endAuthSession(request, context.runtime, context.store);
    return authRedirect(result.location, [result.clearCookie]);
  } catch (error) {
    return authProblem(error instanceof WebAuthFlowError ? 400 : 503);
  }
}
