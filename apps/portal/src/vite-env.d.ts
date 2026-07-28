/// <reference types="vite/client" />

/**
 * The portal's build-time configuration.
 *
 * Nothing here is secret: a client id, an issuer and an API base are public by
 * construction in a browser app. The bearer token is obtained at runtime and
 * never persisted (see `auth.ts`).
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_PROJECT_SLUG?: string;
  readonly VITE_KEYCLOAK_ISSUER?: string;
  readonly VITE_KEYCLOAK_CLIENT_ID?: string;
  readonly VITE_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
