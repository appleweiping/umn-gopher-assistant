export interface AuthPrincipal {
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly subject: string;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AuthPrincipal>;
}

export interface RequestWithAuthPrincipal {
  authPrincipal?: AuthPrincipal;
}
