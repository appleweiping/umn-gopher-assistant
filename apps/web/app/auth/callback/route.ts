import { clearTransactionCookie } from "../../../lib/auth/session-records";
import { authProblem, authRedirect, webAuthRouteContext } from "../../../lib/auth/route-support";
import { completeLogin, WebAuthFlowError } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  let clearCookie: string | undefined;
  try {
    const context = await webAuthRouteContext();
    clearCookie = clearTransactionCookie(context.runtime);
    const result = await completeLogin(request, context.runtime, context.store);
    return authRedirect(result.location, [result.clearTransactionCookie, result.setSessionCookie]);
  } catch (error) {
    return authProblem(error instanceof WebAuthFlowError ? 400 : 503, clearCookie);
  }
}
