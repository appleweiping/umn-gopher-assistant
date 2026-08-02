export interface AuthPrincipal {
  readonly clientId: string;
  /** Exact, signature-verified OIDC issuer. Never derive it from request headers. */
  readonly issuer: string;
  readonly scopes: readonly string[];
  readonly subject: string;
}

export interface VerifiedAccessToken {
  readonly clientId: string;
  /** RFC 7638 thumbprint carried in the signed access-token `cnf.jkt` claim. */
  readonly dpopJkt: string;
  readonly issuer: string;
  readonly scopes: readonly string[];
  readonly subject: string;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

export interface DpopProofInput {
  readonly accessToken: string;
  readonly authorization: VerifiedAccessToken;
  readonly method: string;
  readonly proof: string;
  readonly rawUrl: string;
}

export interface DpopProofVerifier {
  verify(input: DpopProofInput): Promise<void>;
}

export interface RequestWithAuthPrincipal {
  authPrincipal?: AuthPrincipal;
}
