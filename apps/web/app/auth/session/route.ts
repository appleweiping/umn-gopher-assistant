import { tokenFreeSessionResponse, webAuthRouteContext } from "../../../lib/auth/route-support";
import { resolveAuthSession } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await webAuthRouteContext();
    const result = await resolveAuthSession(request, context.runtime, context.store);
    return result.authenticated
      ? tokenFreeSessionResponse(
          { authenticated: true, expiresAt: result.record.accessTokenExpiresAt },
          result.setCookie,
        )
      : tokenFreeSessionResponse({ authenticated: false }, result.clearCookie);
  } catch {
    // Session introspection is deliberately fail-closed and does not expose
    // whether Redis, OIDC configuration, or token verification was at fault.
    return tokenFreeSessionResponse({ authenticated: false });
  }
}
