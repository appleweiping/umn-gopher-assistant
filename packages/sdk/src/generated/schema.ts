/**
 * Generated from openapi/openapi.yaml. DO NOT EDIT.
 * Run `pnpm --filter @umn-gopher-assistant/sdk generate` after contract changes.
 */

export interface paths {
    readonly "/v1/academics/courses": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * List institution-scoped academic course metadata
         * @description Contract-only until an approved academic connector is enabled.
         */
        readonly get: operations["listAcademicCourses"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/academics/sessions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * List normalized academic sessions for one campus
         * @description Uses only reviewed, explicit UMN term IDs and never performs an unfiltered Sessions request.
         *     `from` and `to` must be supplied together and span at most 183 days. When omitted, the server
         *     uses and discloses a 120-day America/Chicago window. Unsupported term windows fail closed.
         *     The upstream dataset is revalidated for every request, including conditional requests, so
         *     callers must tolerate official-source latency and 503 degradation to the supplied official URL.
         */
        readonly get: operations["listAcademicSessions"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/admin/sources/{sourceId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        /**
         * Update reviewed source-policy metadata
         * @description This operation cannot enable a connector or establish official status without external evidence.
         */
        readonly patch: operations["updateSourcePolicy"];
        readonly trace?: never;
    };
    readonly "/v1/ai/query": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Query the public bilingual campus retrieval assistant
         * @description Performs deterministic no-key hybrid retrieval over project-authored campus summaries. Every non-empty
         *     answer is backed by a project-authored summary, citations are confined to the requested campus, and
         *     stale or conflicting summaries are disclosed as a response state instead of being elevated to official
         *     fact. Each citation separates the reusable project-authored text from an official UMN link supplied
         *     only so a user can verify the summary; the linked official content is not retrieved or reproduced. The response
         *     contract requires unique paragraph and citation IDs, resolvable paragraph citation references,
         *     no unused citations, a `schematic` summary verification state, empty evidence for `no-results`, only
         *     FRESH summaries for `answered`, only STALE or EXPIRED summaries for `stale`, and genuinely different
         *     authored documents, official verification links, and content hashes for `conflict`. Queries are
         *     NFC-normalized plain text without control characters or HTML encodings.
         */
        readonly post: operations["queryCampusAssistant"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/campuses": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List supported campuses and academic-calendar mappings */
        readonly get: operations["listCampuses"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/community/posts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List moderated community posts */
        readonly get: operations["listCommunityPosts"];
        readonly put?: never;
        /** Submit a post to the moderation pipeline */
        readonly post: operations["createCommunityPost"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/events": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * List normalized public events
         * @description Returns a bounded, transient view from a reviewed live source. `campusId` is required.
         *     `from` and `to` must be supplied together and span at most 183 days. When both are omitted,
         *     the server uses a disclosed 120-day America/Chicago window. Each request fetches at most
         *     three upstream pages on demand; `retrievalCoverage` discloses the partial live view and any
         *     source-policy truncation. Cursors bind the query and the revalidated upstream page snapshot,
         *     so a changed page returns 410 instead of silently mixing snapshots. LIVE_ONLY content is
         *     never cached and cross-page snapshot consistency is not claimed. A signed cursor also carries
         *     the accepted raw-byte traversal total. The 8 MiB accepted-content budget is checked after each
         *     independently 2 MiB-capped fetch; a crossing page is discarded, never returned, and terminates
         *     traversal with `truncatedByPolicy=true`. A single response never contains duplicate event IDs:
         *     byte-identical cross-page duplicates are skipped and conflicting duplicates fail closed. Because
         *     this LIVE_ONLY cursor is stateless, a distant overlap may repeat an identical ID in a later response;
         *     clients merging cursor pages must drop semantically identical IDs and reject conflicting content.
         */
        readonly get: operations["listEvents"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/health": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Return process liveness
         * @description This anonymous endpoint proves that the HTTP process can serve requests. It is not a
         *     production readiness signal and does not probe the DPoP replay Redis service, personal-vault
         *     PostgreSQL, the identity provider, or optional catalog and AI dependencies.
         */
        readonly get: operations["getHealth"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/live-events/{eventId}/join": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Issue a short-lived, device-bound live-event join ticket */
        readonly post: operations["joinLiveEvent"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/messages": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List messages visible to the authenticated user */
        readonly get: operations["listMessages"];
        readonly put?: never;
        /** Send a private message through the moderated delivery pipeline */
        readonly post: operations["createMessage"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/moderation/cases": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List moderation cases authorized for the reviewer */
        readonly get: operations["listModerationCases"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/personal/vault": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Read the current encrypted vault snapshot
         * @description Requires a fresh, single-use Ed25519 proof from a device or recovery authorization key
         *     already present in the current manifest. The proof is consumed even when `If-None-Match`
         *     produces 304. The server validates authenticated metadata and signatures but cannot decrypt
         *     the payload, wrapped root key, or private records.
         */
        readonly get: operations["readPersonalVault"];
        readonly put?: never;
        /**
         * Create the authenticated account's encrypted vault
         * @description Creates one genesis snapshot. `If-None-Match` must be exactly `*`; the
         *     `Idempotency-Key` must exactly equal the command's canonical UUID `operationId`.
         *     An existing account vault fails the create precondition with 412; 409 is reserved for
         *     idempotency-key reuse with different content or another non-precondition state conflict.
         */
        readonly post: operations["createPersonalVault"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/personal/vault/bootstrap": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Bootstrap the authenticated account-bound encrypted vault
         * @description Returns only the opaque account binding needed to construct a client-side encrypted vault
         *     and minimal existence metadata. For an existing vault it also returns only the current public
         *     recovery-authorization descriptor so a fresh device can validate a high-entropy recovery code
         *     before making a recovery-signed read. It never returns the OIDC subject, internal account ID,
         *     authorization manifest, encrypted payload, key envelopes, device list, or any private plaintext.
         */
        readonly get: operations["bootstrapPersonalVault"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/personal/vault/device-pairings": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List bounded device-pairing requests for the current vault */
        readonly get: operations["listPersonalVaultDevicePairings"];
        readonly put?: never;
        /**
         * Create a short-lived request to add a new device
         * @description The pending device proves possession of both public-key identities. At most eight
         *     unexpired pairing requests may coexist for one vault, and pairing is rejected once the
         *     authorization manifest has reached its 32-device descriptor limit.
         */
        readonly post: operations["createPersonalVaultDevicePairing"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/personal/vault/device-pairings/{pairingId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Cancel one pending device-pairing request */
        readonly delete: operations["cancelPersonalVaultDevicePairing"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/personal/vault/device-pairings/{pairingId}/approval": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Approve a pairing with an atomic signed vault commit */
        readonly post: operations["approvePersonalVaultDevicePairing"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/personal/vault/payload": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /**
         * Commit a new encrypted personal-vault payload
         * @description Requires exactly one strong `If-Match` validator. A stale validator returns 412 and never
         *     merges ciphertext server-side. The `Idempotency-Key` must equal the command `operationId`.
         */
        readonly put: operations["updatePersonalVaultPayload"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/personal/vault/rotations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Atomically rotate the root vault key and authorization epoch */
        readonly post: operations["rotatePersonalVaultKey"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/places": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List public places with provenance and verification state */
        readonly get: operations["listPlaces"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/routes": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Calculate a provenance-bound campus route
         * @description Safety-critical and accessibility routing must return 503 until its topology and operating
         *     procedure are verified. A schematic response must never be presented as verified guidance.
         */
        readonly post: operations["calculateRoute"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/sources": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List provenance and connector-policy descriptors */
        readonly get: operations["listSources"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/worlds/{campusId}/manifest": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Return a versioned schematic or verified world manifest */
        readonly get: operations["getWorldManifest"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        readonly AcademicCourse: {
            readonly academicInstitutionCode: components["schemas"]["AcademicInstitutionCode"];
            readonly campusIds: readonly components["schemas"]["CampusId"][];
            readonly catalogNumber: string;
            readonly id: string;
            readonly sourceId: string;
            readonly subject: string;
            readonly termCode: string;
            readonly title: components["schemas"]["BilingualText"];
            readonly verificationState: components["schemas"]["VerificationState"];
        };
        readonly AcademicCoursePage: components["schemas"]["PageEnvelope"] & {
            readonly items: readonly components["schemas"]["AcademicCourse"][];
        };
        /** @enum {string} */
        readonly AcademicInstitutionCode: "UMNTC" | "UMNDL" | "UMNCR" | "UMNMO";
        readonly AcademicSession: {
            readonly academicCareerCode: string;
            readonly beginDate: string;
            readonly campusId: components["schemas"]["CampusId"];
            readonly endDate: string;
            readonly enrollmentOpenDate: string | null;
            readonly id: string;
            readonly institutionCode: components["schemas"]["AcademicInstitutionCode"];
            readonly name: string;
            /** Format: date-time */
            readonly observedAt: string;
            readonly sessionCode: string;
            readonly sourceId: string;
            readonly sourceObservationId: string;
            readonly termCode: string;
        } & (unknown & unknown & unknown & unknown);
        readonly AcademicSessionPage: {
            readonly items: readonly components["schemas"]["AcademicSession"][];
            readonly nextCursor: string | null;
            readonly range: components["schemas"]["CatalogRange"];
            readonly retrievalCoverage: components["schemas"]["RetrievalCoverage"];
            readonly sourceObservations: readonly components["schemas"]["SourceObservation"][];
        };
        readonly AdminSourcePolicyUpdate: {
            readonly attribution?: string;
            /** @enum {string} */
            readonly cachePolicy?: "CACHE_ALLOWED" | "METADATA_ONLY" | "NO_CONTENT_CACHE" | "NO_ACCESS";
            readonly licenseStatus?: components["schemas"]["LicenseStatus"];
            readonly verificationState?: components["schemas"]["VerificationState"];
        } & (unknown & unknown);
        readonly AiAnswerParagraph: {
            /** @description Unique IDs that must resolve to citations in the same response. */
            readonly citationIds: readonly string[];
            readonly id: string;
            readonly text: string;
        };
        readonly AiBilingualText: {
            readonly en: string;
            readonly "zh-CN": string;
        };
        /** @description A project-authored summary and a separately identified official link where the user can verify it. The two nested source IDs must be different. */
        readonly AiCitation: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly category: components["schemas"]["AiCitationCategory"];
            readonly contentSha256: string;
            readonly documentId: string;
            readonly excerpt: string;
            readonly id: string;
            /** @enum {string} */
            readonly summaryFreshnessState: "FRESH" | "STALE" | "EXPIRED";
            readonly summarySource: components["schemas"]["AiSummarySource"];
            /**
             * @description Link-only summaries cannot claim a reviewed or verified state without a review-evidence artifact.
             * @constant
             */
            readonly summaryVerificationState: "schematic";
            readonly title: components["schemas"]["AiBilingualText"];
            /** Format: date-time */
            readonly updatedAt: string;
            readonly verificationLink: components["schemas"]["AiVerificationLink"];
        };
        /** @enum {string} */
        readonly AiCitationCategory: "library" | "student-services" | "safety" | "transportation" | "dining";
        /** @enum {string} */
        readonly AiLocale: "en" | "zh-CN";
        readonly AiQueryRequest: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly locale: components["schemas"]["AiLocale"];
            /** @description NFC plain text after leading and trailing whitespace have been removed; HTML and Unicode control/format/surrogate characters are rejected. */
            readonly query: string;
        };
        /**
         * @description `answered`, `stale`, and `conflict` require evidence-backed paragraphs. Paragraph IDs, citation IDs,
         *     and each paragraph's citation IDs are unique; every reference resolves within the response; and every
         *     citation campus matches `campusId`. Every citation is referenced, its authored-summary state is
         *     `schematic`, and its summary freshness is not UNKNOWN. `no-results` has no paragraphs or citations,
         *     `answered` cites only FRESH summaries,
         *     `stale` cites only STALE or EXPIRED summaries, and `conflict` has at least two distinct authored document
         *     IDs, official verification-link source IDs, and content hashes. Every citation in one response is bound
         *     to the same authored-summary corpus SHA-256 snapshot.
         */
        readonly AiQueryResponse: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly citations: readonly components["schemas"]["AiCitation"][];
            readonly locale: components["schemas"]["AiLocale"];
            readonly paragraphs: readonly components["schemas"]["AiAnswerParagraph"][];
            readonly queryId: string;
            readonly retrieval: components["schemas"]["AiRetrieval"];
            readonly state: components["schemas"]["AiQueryState"];
        };
        /** @enum {string} */
        readonly AiQueryState: "answered" | "stale" | "conflict" | "no-results";
        readonly AiRateLimitProblem: components["schemas"]["Problem"] & {
            /** @constant */
            readonly failureCode: "AI_RATE_LIMITED";
            /** @constant */
            readonly status?: 429;
            /** @constant */
            readonly title?: "Too Many Requests";
        };
        readonly AiRetrieval: {
            readonly documentsConsidered: number;
            /** @constant */
            readonly mode: "no-key-hybrid";
        };
        readonly AiSummaryLicense: {
            /** @constant */
            readonly evidenceUrl: "https://www.apache.org/licenses/LICENSE-2.0";
            /** @constant */
            readonly spdxId: "Apache-2.0";
            /** @constant */
            readonly status: "OPEN_REUSE";
        };
        /** @description Provenance for text authored and licensed by the UMN Gopher Assistant project. */
        readonly AiSummarySource: {
            readonly corpusSha256: string;
            /** @constant */
            readonly kind: "project-authored-summary";
            readonly license: components["schemas"]["AiSummaryLicense"];
            readonly sourceId: string;
            /** Format: uri */
            readonly sourceUrl: string;
        };
        readonly AiUnavailableProblem: components["schemas"]["Problem"] & {
            readonly failureCode: string;
            /** @constant */
            readonly status?: 503;
            /** @constant */
            readonly title?: "Service Unavailable";
        };
        /** @description An official UMN deep link supplied only for user verification; its content was not retrieved. */
        readonly AiVerificationLink: {
            /** @constant */
            readonly contentRetrieved: false;
            /** @constant */
            readonly kind: "official-verification-link";
            /** @constant */
            readonly licenseStatus: "DEEPLINK_ONLY";
            readonly sourceId: string;
            /** Format: uri */
            readonly sourceUrl: string;
            /** @constant */
            readonly sourceUse: "verification-link-only";
        };
        readonly Argon2idParametersV1: {
            /** @constant */
            readonly algorithm: "ARGON2ID13";
            readonly memLimitBytes: number;
            readonly opsLimit: number;
            /** @constant */
            readonly outputBytes: 32;
            readonly salt: components["schemas"]["Base64UrlSalt16"];
        };
        /**
         * @description Device IDs and all key IDs are unique. Every device and the current recovery key are bound
         *     to this owner and vault. At least one device remains active and the current recovery key is
         *     not revoked. Lifecycle timestamps and revisions are monotonic.
         */
        readonly AuthorizationManifestV2: {
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly devices: readonly components["schemas"]["DeviceDescriptorV2"][];
            readonly epoch: components["schemas"]["PositiveSafeInteger"];
            /** @constant */
            readonly formatVersion: 2;
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly recoveryAuthorization: components["schemas"]["RecoveryAuthorizationPublicKeyV2"];
            readonly revision: components["schemas"]["PositiveSafeInteger"];
            readonly updatedAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /** @description Canonical authenticated-data bytes encoded as unpadded base64url. */
        readonly Base64UrlAad: string;
        readonly Base64UrlDeviceWrappedKey80: string;
        readonly Base64UrlHash32: string;
        readonly Base64UrlNonce24: string;
        readonly Base64UrlPublicKey32: string;
        readonly Base64UrlRecoveryWrappedKey48: string;
        readonly Base64UrlSalt16: string;
        readonly Base64UrlSignature64: string;
        /**
         * @description XChaCha20-Poly1305 ciphertext over complete 4096-byte sodium padding blocks. Decoded
         *     length is at most 8,388,624 bytes; the whole HTTP JSON body is capped at 16 MiB.
         */
        readonly Base64UrlVaultCiphertext: string;
        readonly BilingualText: {
            readonly en: string;
            readonly "zh-CN": string;
        };
        readonly Campus: {
            readonly academicCalendarCampusId: components["schemas"]["CampusId"];
            readonly academicInstitutionCode: components["schemas"]["AcademicInstitutionCode"];
            readonly city: components["schemas"]["BilingualText"];
            readonly id: components["schemas"]["CampusId"];
            readonly name: components["schemas"]["BilingualText"];
            readonly officialStatus: components["schemas"]["OfficialStatus"];
            /** Format: uri */
            readonly sourceUrl: string;
            readonly timeZone: string;
        };
        /** @enum {string} */
        readonly CampusId: "tc" | "duluth" | "crookston" | "morris" | "rochester";
        readonly CampusWorldManifest: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly etag: string;
            /** Format: date-time */
            readonly generatedAt: string;
            readonly portals: readonly components["schemas"]["WorldPortal"][];
            readonly revision: number;
            readonly sourceIds: readonly string[];
            readonly tiles: readonly components["schemas"]["WorldTile"][];
            readonly verificationState: components["schemas"]["VerificationState"];
            readonly worldVersion: string;
        };
        /** Format: date-time */
        readonly CanonicalUtcDateTime: string;
        readonly CanonicalUuid: string;
        readonly CatalogCursor: string;
        readonly CatalogRange: {
            readonly defaulted: boolean;
            readonly from: string;
            readonly to: string;
        };
        readonly CommunityPost: {
            readonly authorAlias: string;
            readonly body: string;
            readonly campusId: components["schemas"]["CampusId"];
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly moderationState: "PENDING" | "VISIBLE" | "HIDDEN" | "REMOVED";
        };
        readonly CommunityPostPage: components["schemas"]["PageEnvelope"] & {
            readonly items: readonly components["schemas"]["CommunityPost"][];
        };
        readonly ConnectorUnavailableProblem: components["schemas"]["Problem"] & {
            readonly failureCode: string;
            /** Format: uri */
            readonly officialUrl: string;
            readonly sourceId: string;
            /** @constant */
            readonly status?: 503;
            /** @constant */
            readonly title?: "Service Unavailable";
        };
        readonly CreateCommunityPost: {
            readonly body: string;
            readonly campusId: components["schemas"]["CampusId"];
        };
        readonly CreateMessage: {
            readonly body: string;
            readonly recipientActorId: string;
        };
        readonly DeviceAuthorizationPublicKeyV2: {
            /** @constant */
            readonly algorithm: "ED25519";
            readonly fingerprint: components["schemas"]["Base64UrlHash32"];
            readonly keyId: components["schemas"]["CanonicalUuid"];
            readonly publicKey: components["schemas"]["Base64UrlPublicKey32"];
        };
        /**
         * @description The encryption and authorization key IDs must differ. A non-null revocation timestamp
         *     cannot precede creation; current manifests must retain at least one non-revoked device.
         */
        readonly DeviceDescriptorV2: {
            readonly authorizationKey: components["schemas"]["DeviceAuthorizationPublicKeyV2"];
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly deviceId: components["schemas"]["CanonicalUuid"];
            readonly encryptionKey: components["schemas"]["DeviceEncryptionPublicKeyV2"];
            /** @constant */
            readonly formatVersion: 2;
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly revokedAt: components["schemas"]["NullableCanonicalUtcDateTime"];
        };
        readonly DeviceEncryptionPublicKeyV2: {
            /** @constant */
            readonly algorithm: "X25519";
            readonly fingerprint: components["schemas"]["Base64UrlHash32"];
            readonly keyId: components["schemas"]["CanonicalUuid"];
            readonly publicKey: components["schemas"]["Base64UrlPublicKey32"];
        };
        readonly DeviceKeyEnvelopeV1: {
            /** @constant */
            readonly cipherSuite: "X25519_XCHACHA20_POLY1305";
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly ephemeralPublicKey: components["schemas"]["Base64UrlPublicKey32"];
            /** @constant */
            readonly formatVersion: 1;
            readonly nonce: components["schemas"]["Base64UrlNonce24"];
            readonly recipientDeviceId: components["schemas"]["CanonicalUuid"];
            readonly recipientKeyId: components["schemas"]["CanonicalUuid"];
            readonly recipientPublicKeyFingerprint: components["schemas"]["Base64UrlHash32"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
            readonly vaultKeyId: components["schemas"]["CanonicalUuid"];
            readonly wrappedKey: components["schemas"]["Base64UrlDeviceWrappedKey80"];
        };
        readonly DevicePairingPageV2: {
            readonly items: readonly components["schemas"]["DevicePairingViewV2"][];
        };
        /**
         * @description A new non-revoked device signs this request. The request is bound to the current owner and
         *     vault; its lifetime is positive and at most fifteen minutes.
         */
        readonly DevicePairingRequestV2: {
            readonly expiresAt: components["schemas"]["CanonicalUtcDateTime"];
            /** @constant */
            readonly formatVersion: 2;
            readonly issuedAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly operationId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly pairingCodeCommitment: components["schemas"]["Base64UrlHash32"];
            readonly requestingDevice: components["schemas"]["DeviceDescriptorV2"];
            readonly signature: components["schemas"]["Base64UrlSignature64"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /** @description Lifecycle timestamps are canonical and monotonic; the pairing expires no earlier than creation. */
        readonly DevicePairingViewV2: {
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly expiresAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly id: components["schemas"]["CanonicalUuid"];
            readonly requestingDevice: components["schemas"]["DeviceDescriptorV2"];
            /** @enum {string} */
            readonly state: "pending" | "approved" | "consumed" | "expired" | "cancelled";
            readonly updatedAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        readonly DevicePublicKeyV1: {
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly deviceId: components["schemas"]["CanonicalUuid"];
            readonly deviceKeyId: components["schemas"]["CanonicalUuid"];
            /** @constant */
            readonly formatVersion: 1;
            /** @constant */
            readonly keyAlgorithm: "X25519";
            readonly publicKey: components["schemas"]["Base64UrlPublicKey32"];
            readonly publicKeyFingerprint: components["schemas"]["Base64UrlHash32"];
            readonly revokedAt: components["schemas"]["NullableCanonicalUtcDateTime"];
        };
        /**
         * @description Revision one has a null base revision; later revisions advance exactly one. `aad` is the
         *     canonical account-bound V2 metadata tuple and ciphertext contains only padded client data.
         */
        readonly EncryptedVaultPayloadEnvelopeV2: {
            readonly aad: components["schemas"]["Base64UrlAad"];
            readonly baseRevision: components["schemas"]["NullablePositiveSafeInteger"];
            /** @constant */
            readonly cipherSuite: "XCHACHA20_POLY1305";
            readonly ciphertext: components["schemas"]["Base64UrlVaultCiphertext"];
            /** @constant */
            readonly contentSchemaVersion: 1;
            /** @constant */
            readonly contentType: "application/vnd.umn-gopher-assistant.personal-vault+json";
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            /** @constant */
            readonly formatVersion: 2;
            readonly nonce: components["schemas"]["Base64UrlNonce24"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly padding: components["schemas"]["VaultPayloadPaddingV1"];
            readonly revision: components["schemas"]["PositiveSafeInteger"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
            readonly vaultKeyId: components["schemas"]["CanonicalUuid"];
        };
        readonly Event: {
            readonly allDay: boolean;
            readonly campusId: components["schemas"]["CampusId"];
            /** Format: uri */
            readonly canonicalUrl: string;
            readonly categories: readonly string[];
            readonly descriptionText: string | null;
            /** Format: date-time */
            readonly endsAt: string | null;
            readonly id: string;
            readonly language: string;
            readonly location: components["schemas"]["PublicEventLocation"];
            /** Format: date-time */
            readonly observedAt: string;
            readonly sourceId: string;
            readonly sourceObservationId: string;
            /** Format: date-time */
            readonly startsAt: string;
            /** @enum {string} */
            readonly status: "SCHEDULED" | "POSTPONED" | "CANCELLED";
            readonly timeZone: string;
            readonly title: string;
        };
        readonly EventPage: {
            readonly items: readonly components["schemas"]["Event"][];
            readonly nextCursor: string | null;
            readonly range: components["schemas"]["CatalogRange"];
            readonly retrievalCoverage: components["schemas"]["RetrievalCoverage"];
            readonly sourceObservations: readonly components["schemas"]["SourceObservation"][];
        };
        /** @enum {string} */
        readonly FreshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
        readonly GeoPoint: readonly [
            number,
            number
        ];
        readonly Health: {
            /** @constant */
            readonly service: "campus-api";
            /** @constant */
            readonly status: "ok";
            /** Format: date-time */
            readonly time: string;
            readonly version: string;
        };
        /** @enum {string} */
        readonly LicenseStatus: "OPEN_REUSE" | "LIVE_ONLY" | "DEEPLINK_ONLY" | "APPROVAL_REQUIRED" | "PROHIBITED";
        readonly LiveEventJoinRequest: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly deviceBoundNonce: string;
            readonly scopes: readonly ("world:join" | "presence:publish" | "media:publish")[];
        };
        readonly Message: {
            readonly body: string;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly readAt: string | null;
            readonly recipientActorId: string;
            readonly senderActorId: string;
            /** Format: uuid */
            readonly threadId: string;
        };
        readonly MessagePage: components["schemas"]["PageEnvelope"] & {
            readonly items: readonly components["schemas"]["Message"][];
        };
        readonly ModerationCase: {
            readonly assignedModeratorId: string | null;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly kind: "COMMUNITY_REPORT" | "LIVE_SAFETY_REPORT" | "AUTOMATED_SIGNAL";
            /** @enum {string} */
            readonly priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
            readonly reasonCodes: readonly string[];
            readonly reporterActorId: string | null;
            readonly resolution: components["schemas"]["ModerationResolution"] | null;
            /** @enum {string} */
            readonly state: "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
            readonly target: components["schemas"]["ModerationTarget"];
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly ModerationCasePage: components["schemas"]["PageEnvelope"] & {
            readonly items: readonly components["schemas"]["ModerationCase"][];
        };
        readonly ModerationResolution: {
            /** @enum {string} */
            readonly action: "NO_ACTION" | "CONTENT_REMOVED" | "USER_WARNED" | "USER_SUSPENDED" | "ESCALATED";
            readonly rationale: string;
            /** Format: date-time */
            readonly resolvedAt: string;
            readonly resolvedBy: string;
        };
        readonly ModerationTarget: {
            readonly id: string;
            /** @enum {string} */
            readonly type: "community_post" | "community_comment" | "live_session" | "user_profile";
        };
        readonly NullableBase64UrlHash32: string | null;
        /** Format: date-time */
        readonly NullableCanonicalUtcDateTime: string | null;
        readonly NullableCanonicalUuid: string | null;
        readonly NullablePositiveSafeInteger: number | null;
        /** @enum {string} */
        readonly OfficialStatus: "UNVERIFIED" | "PUBLISHER_ASSERTED" | "PARTNERSHIP_VERIFIED";
        /** @description Opaque HMAC-derived account binding; never an OIDC subject or internal account ID. */
        readonly OwnerBindingV2: string;
        readonly PageEnvelope: {
            readonly items: readonly unknown[];
            /** @description Opaque cursor for the next page, null when exhausted. */
            readonly nextCursor: string | null;
        };
        readonly PairingApprovalRequestV2: {
            readonly command: components["schemas"]["VaultPairDeviceCommandV2"];
            readonly pairingCodeCommitment: components["schemas"]["Base64UrlHash32"];
        };
        readonly PersonalVaultBootstrapV2: {
            /** @constant */
            readonly formatVersion: 2;
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly vault: {
                /** @constant */
                readonly exists: false;
            } | {
                readonly etag: string;
                /** @constant */
                readonly exists: true;
                readonly recoveryAuthorization: components["schemas"]["RecoveryAuthorizationPublicKeyV2"];
                readonly vaultId: components["schemas"]["CanonicalUuid"];
            };
        };
        readonly Place: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly id: string;
            readonly location: components["schemas"]["GeoPoint"];
            readonly name: components["schemas"]["BilingualText"];
            readonly sourceIds: readonly string[];
            readonly verificationState: components["schemas"]["VerificationState"];
        };
        readonly PlacePage: components["schemas"]["PageEnvelope"] & {
            readonly items: readonly components["schemas"]["Place"][];
        };
        readonly PositiveSafeInteger: number;
        /** @description RFC 9457 problem details. Unknown extension members may be added. */
        readonly Problem: {
            readonly detail: string;
            /** Format: uri-reference */
            readonly instance: string;
            readonly status: number;
            readonly title: string;
            readonly traceId: string;
            /** Format: uri-reference */
            readonly type: string;
        };
        readonly PublicEventLocation: (({
            readonly address: string | null;
            readonly coordinates: readonly number[] | null;
            readonly name: string | null;
            /** Format: uri */
            readonly onlineUrl: string | null;
        } & unknown) | null) & unknown;
        readonly RecoveryAuthorizationPublicKeyV2: {
            /** @constant */
            readonly algorithm: "ED25519";
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly fingerprint: components["schemas"]["Base64UrlHash32"];
            /** @constant */
            readonly formatVersion: 2;
            readonly keyId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly publicKey: components["schemas"]["Base64UrlPublicKey32"];
            readonly revokedAt: components["schemas"]["NullableCanonicalUtcDateTime"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /** @description The `aad` value must exactly encode the canonical V1 recovery metadata. */
        readonly RecoveryKeyEnvelopeV1: {
            readonly aad: components["schemas"]["Base64UrlAad"];
            /** @constant */
            readonly cipherSuite: "XCHACHA20_POLY1305";
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            /** @constant */
            readonly formatVersion: 1;
            readonly kdf: components["schemas"]["Argon2idParametersV1"];
            readonly nonce: components["schemas"]["Base64UrlNonce24"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
            readonly vaultKeyId: components["schemas"]["CanonicalUuid"];
            readonly wrappedKey: components["schemas"]["Base64UrlRecoveryWrappedKey48"];
        };
        readonly RetrievalCoverage: {
            readonly nextUpstreamPage: number | null;
            readonly pagesFetched: number;
            /** @description Sessions may contain up to 50,000 records; the events runtime is independently capped at 150 per request. */
            readonly recordsFetched: number;
            readonly sourceTotalPages: number;
            readonly sourceTotalRecords: number;
            /** @description True when the source exceeds the reviewed 20-page or 1,000-record access ceiling. */
            readonly truncatedByPolicy: boolean;
        };
        /** @enum {string} */
        readonly RouteProfile: "walking" | "wheelchair";
        readonly RouteRequest: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly destination: components["schemas"]["GeoPoint"];
            readonly origin: components["schemas"]["GeoPoint"];
            readonly profile: components["schemas"]["RouteProfile"];
        };
        readonly RouteResult: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly profile: components["schemas"]["RouteProfile"];
            /** Format: uuid */
            readonly routeId: string;
            readonly segments: readonly components["schemas"]["RouteSegment"][];
            readonly verificationState: components["schemas"]["VerificationState"];
        };
        readonly RouteSegment: {
            readonly distanceMeters: number;
            readonly durationSeconds: number;
            readonly geometry: readonly components["schemas"]["GeoPoint"][];
            readonly id: string;
            readonly instructions: components["schemas"]["BilingualText"];
            readonly profile: components["schemas"]["RouteProfile"];
            readonly safetyCritical: boolean;
            readonly sourceIds: readonly string[];
            /** Format: date-time */
            readonly validUntil: string | null;
            readonly verificationState: components["schemas"]["VerificationState"];
        };
        /**
         * @description Public source-governance record. LIVE_ONLY access is fail-closed unless authorization evidence,
         *     a review timestamp, and a later review expiry are all present. The review interval is validated
         *     by the shared contract to be no longer than 366 days. APPROVAL_REQUIRED and PROHIBITED sources
         *     cannot carry live-access review timestamps.
         */
        readonly SourceDescriptor: {
            readonly attribution: string;
            /** Format: uri */
            readonly authorizationEvidenceUrl: string | null;
            readonly cacheDisposition: {
                /** @enum {string} */
                readonly derivedArtifacts: "PROHIBITED" | "SAME_RETENTION" | "SEPARATE_APPROVAL";
                /** @enum {string} */
                readonly normalizedRecords: "NEVER_STORE" | "TRANSIENT_ONLY" | "PERSIST_WITH_TTL";
                /** @enum {string} */
                readonly rawResponse: "NEVER_STORE" | "TRANSIENT_ONLY" | "PERSIST_WITH_TTL";
                readonly retentionSeconds: number | null;
            };
            /** @enum {string} */
            readonly cachePolicy: "CACHE_ALLOWED" | "METADATA_ONLY" | "NO_CONTENT_CACHE" | "NO_ACCESS";
            readonly campusIds: readonly components["schemas"]["CampusId"][];
            readonly dataClasses: readonly ("PUBLIC_METADATA" | "COPYRIGHTED_CONTENT" | "PRECISE_LOCATION" | "PERSONAL_DATA" | "SENSITIVE_DATA" | "SAFETY_CRITICAL" | "MEDIA")[];
            /** @enum {string} */
            readonly dataClassification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
            readonly freshnessState: components["schemas"]["FreshnessState"];
            readonly id: string;
            readonly killSwitch: {
                /** @enum {string} */
                readonly defaultState: "ENABLED" | "DISABLED";
                /** @enum {string} */
                readonly fallback: "DEEPLINK_ONLY" | "UNAVAILABLE";
                readonly key: string;
            };
            /** Format: date-time */
            readonly lastCheckedAt: string | null;
            /** Format: uri */
            readonly licenseEvidenceUrl: string | null;
            readonly licenseStatus: components["schemas"]["LicenseStatus"];
            readonly name: components["schemas"]["BilingualText"];
            readonly officialStatus: components["schemas"]["OfficialStatus"];
            readonly owner: {
                /** Format: uri */
                readonly contactUrl: string;
                readonly teamId: string;
            };
            readonly publisher: string;
            readonly resourceKinds: readonly ("CAMPUS_DEEPLINK" | "ACADEMIC_SESSION" | "PUBLIC_EVENT" | "AI_KNOWLEDGE_SUMMARY" | "AI_VERIFICATION_LINK")[];
            /** Format: uri */
            readonly sourceUrl: string;
            /** Format: date-time */
            readonly termsReviewedAt: string | null;
            /** Format: date-time */
            readonly termsReviewExpiresAt: string | null;
            readonly verificationState: components["schemas"]["VerificationState"];
        } & (unknown & unknown & unknown & unknown & unknown);
        readonly SourceObservation: {
            /** @enum {string} */
            readonly appliedCacheDisposition: "NO_ACCESS" | "DISCARDED_AFTER_RESPONSE" | "OPERATIONAL_METADATA_ONLY" | "CONTENT_CACHED";
            /** @enum {string} */
            readonly cachePolicy: "CACHE_ALLOWED" | "METADATA_ONLY" | "NO_CONTENT_CACHE" | "NO_ACCESS";
            readonly campusId: components["schemas"]["CampusId"];
            /** @enum {string} */
            readonly dataClassification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
            readonly durationMs: number;
            readonly failureCode: null;
            readonly freshnessState: components["schemas"]["FreshnessState"];
            readonly httpStatus: number;
            readonly licenseStatus: components["schemas"]["LicenseStatus"];
            readonly observationId: string;
            /** Format: date-time */
            readonly observedAt: string;
            /** @constant */
            readonly outcome: "SUCCESS";
            readonly parserVersion: string;
            readonly rawByteLength: number;
            readonly rawSha256: string;
            readonly recordsAccepted: number;
            readonly recordsRejected: number;
            readonly sourceId: string;
        };
        readonly SourcePage: components["schemas"]["PageEnvelope"] & {
            readonly items: readonly components["schemas"]["SourceDescriptor"][];
        };
        /**
         * @description Short-lived Ed25519 proof binding command type, owner, vault, operation ID, expected parent,
         *     next commit, and signer. Lifetime is positive and at most ten minutes.
         */
        readonly VaultCommandProofV2: {
            /** @enum {string} */
            readonly commandType: "CREATE_VAULT" | "UPDATE_PAYLOAD" | "PAIR_DEVICE" | "ROTATE_KEY";
            readonly expectedParentCommitHash: components["schemas"]["NullableBase64UrlHash32"];
            readonly expiresAt: components["schemas"]["CanonicalUtcDateTime"];
            /** @constant */
            readonly formatVersion: 2;
            readonly issuedAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly nextCommitHash: components["schemas"]["Base64UrlHash32"];
            readonly operationId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly signature: components["schemas"]["Base64UrlSignature64"];
            readonly signer: components["schemas"]["VaultCommitAuthorV2"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /** @description The `deviceId` value is non-null only for `DEVICE` authors. */
        readonly VaultCommitAuthorV2: {
            readonly deviceId: components["schemas"]["NullableCanonicalUuid"];
            readonly keyId: components["schemas"]["CanonicalUuid"];
            /** @enum {string} */
            readonly kind: "DEVICE" | "RECOVERY";
        };
        /**
         * @description Only the epoch-one sequence-one genesis commit has a null parent. Hashes bind the payload,
         *     keyring, authorization manifest, and preceding commit. The public-key `signature` is checked
         *     by the service. `stateMac` is bound into the commit hash and signed mutation command, but only
         *     a client holding the root vault key can verify that MAC when reading stored state.
         */
        readonly VaultCommitV2: {
            readonly author: components["schemas"]["VaultCommitAuthorV2"];
            readonly authorizationManifestHash: components["schemas"]["Base64UrlHash32"];
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly epoch: components["schemas"]["PositiveSafeInteger"];
            /** @constant */
            readonly formatVersion: 2;
            readonly keyringHash: components["schemas"]["Base64UrlHash32"];
            readonly operationId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly parentCommitHash: components["schemas"]["NullableBase64UrlHash32"];
            readonly payloadHash: components["schemas"]["Base64UrlHash32"];
            readonly sequence: components["schemas"]["PositiveSafeInteger"];
            readonly signature: components["schemas"]["Base64UrlSignature64"];
            readonly stateMac: components["schemas"]["Base64UrlHash32"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /** @description Genesis snapshot and proof metadata must bind exactly to this command. */
        readonly VaultCreateCommandV2: {
            /** @constant */
            readonly commandType: "CREATE_VAULT";
            /** @constant */
            readonly formatVersion: 2;
            readonly operationId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly proof: components["schemas"]["VaultCommandProofV2"];
            readonly snapshot: components["schemas"]["VaultSyncSnapshotV2"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /**
         * @description Device recipients and key IDs are unique and match optional public-key descriptors one to
         *     one. Every envelope is for this vault and root key, and lifecycle timestamps are monotonic.
         */
        readonly VaultKeyringV1: {
            readonly createdAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly deviceEnvelopes: readonly components["schemas"]["DeviceKeyEnvelopeV1"][];
            readonly devicePublicKeys?: readonly components["schemas"]["DevicePublicKeyV1"][];
            /** @constant */
            readonly formatVersion: 1;
            readonly recoveryEnvelope: components["schemas"]["RecoveryKeyEnvelopeV1"];
            readonly revision: components["schemas"]["PositiveSafeInteger"];
            readonly updatedAt: components["schemas"]["CanonicalUtcDateTime"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
            readonly vaultKeyId: components["schemas"]["CanonicalUuid"];
        };
        /**
         * @description Adds exactly the approved active device, preserves the encrypted payload and existing
         *     active devices, and advances keyring, manifest, and commit exactly once.
         */
        readonly VaultPairDeviceCommandV2: {
            /** @constant */
            readonly commandType: "PAIR_DEVICE";
            readonly expectedParentCommitHash: components["schemas"]["Base64UrlHash32"];
            /** @constant */
            readonly formatVersion: 2;
            readonly nextSnapshot: components["schemas"]["VaultSyncSnapshotV2"];
            readonly operationId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly pairedDevice: components["schemas"]["DeviceDescriptorV2"];
            readonly proof: components["schemas"]["VaultCommandProofV2"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        readonly VaultPayloadPaddingV1: {
            /** @constant */
            readonly algorithm: "SODIUM_PAD";
            /** @constant */
            readonly blockSize: 4096;
        };
        /**
         * @description Atomically advances root-key identity, epoch, payload, keyring, manifest, and commit. A
         *     DEVICE_REVOKED reason requires a newly revoked device; RECOVERY_ROTATED requires a new
         *     recovery authorization key.
         */
        readonly VaultRotateKeyCommandV2: {
            /** @constant */
            readonly commandType: "ROTATE_KEY";
            readonly expectedParentCommitHash: components["schemas"]["Base64UrlHash32"];
            /** @constant */
            readonly formatVersion: 2;
            readonly nextSnapshot: components["schemas"]["VaultSyncSnapshotV2"];
            readonly operationId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly proof: components["schemas"]["VaultCommandProofV2"];
            /** @enum {string} */
            readonly reason: "DEVICE_REVOKED" | "RECOVERY_ROTATED" | "SCHEDULED" | "COMPROMISE";
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /**
         * @description All components must use this owner and vault. The root-key identity, authorization epoch,
         *     component hashes, current author, and Ed25519 signature are validated as one atomic snapshot
         *     before storage or return. On mutation, the short-lived signed command also binds the exact
         *     commit hash (including `stateMac`). A reader must still verify `stateMac` with its root key;
         *     the service never possesses that key and cannot independently validate the MAC.
         */
        readonly VaultSyncSnapshotV2: {
            readonly authorizationManifest: components["schemas"]["AuthorizationManifestV2"];
            readonly commit: components["schemas"]["VaultCommitV2"];
            readonly commitHash: components["schemas"]["Base64UrlHash32"];
            /** @constant */
            readonly formatVersion: 2;
            readonly keyring: components["schemas"]["VaultKeyringV1"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly payload: components["schemas"]["EncryptedVaultPayloadEnvelopeV2"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /**
         * @description Advances payload and commit exactly once without changing the keyring or authorization
         *     manifest. Proof, parent hash, operation ID, and next snapshot must bind exactly.
         */
        readonly VaultUpdatePayloadCommandV2: {
            /** @constant */
            readonly commandType: "UPDATE_PAYLOAD";
            readonly expectedParentCommitHash: components["schemas"]["Base64UrlHash32"];
            /** @constant */
            readonly formatVersion: 2;
            readonly nextSnapshot: components["schemas"]["VaultSyncSnapshotV2"];
            readonly operationId: components["schemas"]["CanonicalUuid"];
            readonly ownerBinding: components["schemas"]["OwnerBindingV2"];
            readonly proof: components["schemas"]["VaultCommandProofV2"];
            readonly vaultId: components["schemas"]["CanonicalUuid"];
        };
        /** @enum {string} */
        readonly VerificationState: "schematic" | "surveyed" | "campus-reviewed" | "verified" | "retired";
        readonly WorldJoinTicket: {
            readonly campusId: components["schemas"]["CampusId"];
            readonly deviceBoundNonce: string;
            /** Format: date-time */
            readonly expiresAt: string;
            /** Format: date-time */
            readonly issuedAt: string;
            readonly participantId: string;
            readonly roomName: string;
            readonly scopes: readonly ("world:join" | "presence:publish" | "media:publish")[];
            /** Format: uuid */
            readonly ticketId: string;
            readonly token: string;
        };
        readonly WorldPortal: {
            readonly fromCampusId: components["schemas"]["CampusId"];
            readonly id: string;
            readonly label: components["schemas"]["BilingualText"];
            readonly position: readonly number[];
            readonly targetWorldVersion: string;
            readonly toCampusId: components["schemas"]["CampusId"];
            readonly verificationState: components["schemas"]["VerificationState"];
        };
        readonly WorldTile: {
            readonly bounds: readonly number[];
            readonly byteLength: number;
            readonly contentType: string;
            readonly id: string;
            readonly licenseStatus: components["schemas"]["LicenseStatus"];
            readonly maxZoom: number;
            readonly minZoom: number;
            readonly sha256: string;
            /** Format: uri */
            readonly url: string;
            readonly verificationState: components["schemas"]["VerificationState"];
        };
    };
    responses: {
        /** @description Anonymous campus knowledge query budget is exhausted */
        readonly AiTooManyRequests: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                readonly "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                readonly "RateLimit-Reset": components["headers"]["RateLimitReset"];
                readonly "Retry-After"?: number;
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["AiRateLimitProblem"];
            };
        };
        /** @description Campus knowledge retrieval or its distributed abuse control is temporarily unavailable */
        readonly AiUnavailable: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly "Retry-After"?: number;
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["AiUnavailableProblem"];
            };
        };
        /** @description Malformed request */
        readonly BadRequest: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description State or idempotency-key conflict */
        readonly Conflict: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Required connector is disabled, unapproved, or temporarily unavailable */
        readonly ConnectorUnavailable: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly "Retry-After"?: number;
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["ConnectorUnavailableProblem"];
            };
        };
        /** @description Cursor snapshot is no longer the current normalized source snapshot */
        readonly CursorExpired: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Authenticated principal lacks the required scope or resource authorization */
        readonly Forbidden: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Unexpected server failure */
        readonly InternalServerError: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description The live source was revalidated and the normalized representation has not changed;
         *     the response has no body and remains non-cacheable.
         */
        readonly LiveCatalogNotModified: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly ETag: components["headers"]["ETag"];
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content?: never;
        };
        /** @description Resource was not found */
        readonly NotFound: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Representation has not changed; response has no body. */
        readonly NotModified: {
            headers: {
                readonly ETag: components["headers"]["ETag"];
                readonly [name: string]: unknown;
            };
            content?: never;
        };
        /** @description Request body exceeds the route-specific byte limit */
        readonly PayloadTooLarge: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The supplied strong ETag no longer identifies the current vault state */
        readonly PreconditionFailed: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description A required conditional, possession-proof, or idempotency header is missing */
        readonly PreconditionRequired: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description A required private-sync dependency is temporarily unavailable */
        readonly ServiceUnavailable: {
            headers: {
                readonly "Retry-After"?: number;
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Rate limit exceeded */
        readonly TooManyRequests: {
            headers: {
                readonly "Retry-After"?: number;
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description DPoP authentication is required or invalid. A `use_dpop_nonce` response includes a
         *     fresh nonce and can be retried once with a new proof JWT and `jti`.
         */
        readonly Unauthorized: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly "DPoP-Nonce": components["headers"]["DPoPNonce"];
                readonly "WWW-Authenticate": components["headers"]["WwwAuthenticateDPoP"];
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Semantically invalid or policy-disallowed request */
        readonly UnprocessableEntity: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request body does not use a supported media type */
        readonly UnsupportedMediaType: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description The account-bound encrypted representation has not changed. The response has no body;
         *     a supplied read proof has still been consumed and must not be replayed.
         */
        readonly VaultNotModified: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly ETag: components["headers"]["StrongETag"];
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content?: never;
        };
        /** @description Authenticated encrypted snapshot committed atomically */
        readonly VaultSnapshotMutationSucceeded: {
            headers: {
                readonly "Cache-Control": components["headers"]["NoStore"];
                readonly ETag: components["headers"]["StrongETag"];
                readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                readonly "X-Request-Id": components["headers"]["RequestId"];
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/json": components["schemas"]["VaultSyncSnapshotV2"];
            };
        };
    };
    parameters: {
        readonly AcademicInstitutionQuery: components["schemas"]["AcademicInstitutionCode"];
        readonly CampusPath: components["schemas"]["CampusId"];
        readonly CampusQuery: components["schemas"]["CampusId"];
        /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
        readonly Cursor: components["schemas"]["CatalogCursor"];
        readonly EventIdPath: string;
        /** @description Inclusive local calendar date; must be supplied together with `to`. */
        readonly FromDate: string;
        /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
        readonly IdempotencyKey: string;
        /** @description Conditional request validator from a previous ETag response. */
        readonly IfNoneMatch: string;
        readonly Limit: number;
        readonly PairingIdPath: components["schemas"]["CanonicalUuid"];
        readonly RequiredCampusQuery: components["schemas"]["CampusId"];
        readonly SourceIdPath: string;
        /** @description Inclusive local calendar date; must be supplied together with `from`. */
        readonly ToDate: string;
        /** @description Vault creation is allowed only when no vault exists. */
        readonly VaultCreateIfNoneMatch: "*";
        /**
         * @description Exactly one strong ETag returned by the current vault snapshot. Weak validators, wildcard
         *     validators, and comma-separated validator lists are rejected.
         */
        readonly VaultIfMatch: string;
        /** @description One strong ETag returned by a previous personal-vault response. */
        readonly VaultIfNoneMatch: string;
        /**
         * @description Canonical unpadded base64url JSON containing a short-lived single-use
         *     `VaultReadProofV2`. This proves possession of an authorization private key; it is
         *     independent from the OAuth DPoP credential and is consumed before a possible 304 response.
         */
        readonly VaultReadProof: string;
    };
    requestBodies: never;
    headers: {
        /**
         * @description RFC 9449 server nonce. A client stores this value per protected-resource origin and
         *     DPoP public-key thumbprint, then includes it in the next fresh proof.
         */
        readonly DPoPNonce: string;
        /** @description Entity tag for conditional requests. */
        readonly ETag: string;
        /** @description True when the response is a replay of a prior request with the same key and body. */
        readonly IdempotencyReplayed: boolean;
        /** @description This representation must not be stored by clients or intermediaries. */
        readonly NoStore: "no-store";
        /** @description Maximum anonymous-client requests allowed in the current fixed window. */
        readonly RateLimitLimit: number;
        /** @description Remaining requests for the anonymous client in the current fixed window. */
        readonly RateLimitRemaining: number;
        /** @description Whole seconds until the anonymous client's fixed window resets; this is not an epoch timestamp. */
        readonly RateLimitReset: number;
        /** @description Correlation ID suitable for support, not an authentication credential. */
        readonly RequestId: string;
        /** @description One strong entity tag for optimistic personal-vault concurrency control. */
        readonly StrongETag: string;
        /**
         * @description RFC 9449 DPoP authentication challenge. `error="use_dpop_nonce"` is accompanied by
         *     `DPoP-Nonce`; other values include `invalid_token`, `invalid_dpop_proof`, and
         *     `insufficient_scope`.
         */
        readonly WwwAuthenticateDPoP: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    readonly listAcademicCourses: {
        readonly parameters: {
            readonly query?: {
                readonly academicInstitutionCode?: components["parameters"]["AcademicInstitutionQuery"];
                readonly campusId?: components["parameters"]["CampusQuery"];
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: components["parameters"]["Limit"];
            };
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of course metadata */
            readonly 200: {
                headers: {
                    readonly ETag: components["headers"]["ETag"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AcademicCoursePage"];
                };
            };
            readonly 304: components["responses"]["NotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 503: components["responses"]["ConnectorUnavailable"];
        };
    };
    readonly listAcademicSessions: {
        readonly parameters: {
            readonly query: {
                readonly campusId: components["parameters"]["RequiredCampusQuery"];
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                /** @description Inclusive local calendar date; must be supplied together with `to`. */
                readonly from?: components["parameters"]["FromDate"];
                readonly limit?: components["parameters"]["Limit"];
                /** @description Inclusive local calendar date; must be supplied together with `from`. */
                readonly to?: components["parameters"]["ToDate"];
            };
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of academic sessions */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly ETag: components["headers"]["ETag"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AcademicSessionPage"];
                };
            };
            readonly 304: components["responses"]["LiveCatalogNotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 410: components["responses"]["CursorExpired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ConnectorUnavailable"];
        };
    };
    readonly updateSourcePolicy: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly sourceId: components["parameters"]["SourceIdPath"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["AdminSourcePolicyUpdate"];
            };
        };
        readonly responses: {
            /** @description Updated source descriptor */
            readonly 200: {
                headers: {
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SourceDescriptor"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 422: components["responses"]["UnprocessableEntity"];
        };
    };
    readonly queryCampusAssistant: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["AiQueryRequest"];
            };
        };
        readonly responses: {
            /** @description Grounded assistant response */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly "RateLimit-Limit": components["headers"]["RateLimitLimit"];
                    readonly "RateLimit-Remaining": components["headers"]["RateLimitRemaining"];
                    readonly "RateLimit-Reset": components["headers"]["RateLimitReset"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AiQueryResponse"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 413: components["responses"]["PayloadTooLarge"];
            readonly 415: components["responses"]["UnsupportedMediaType"];
            readonly 429: components["responses"]["AiTooManyRequests"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["AiUnavailable"];
        };
    };
    readonly listCampuses: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Supported campuses */
            readonly 200: {
                headers: {
                    readonly ETag: components["headers"]["ETag"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": readonly components["schemas"]["Campus"][];
                };
            };
            readonly 304: components["responses"]["NotModified"];
            readonly 500: components["responses"]["InternalServerError"];
        };
    };
    readonly listCommunityPosts: {
        readonly parameters: {
            readonly query?: {
                readonly campusId?: components["parameters"]["CampusQuery"];
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: components["parameters"]["Limit"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of posts */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CommunityPostPage"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
        };
    };
    readonly createCommunityPost: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateCommunityPost"];
            };
        };
        readonly responses: {
            /** @description Post accepted */
            readonly 201: {
                headers: {
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly Location?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CommunityPost"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 409: components["responses"]["Conflict"];
            readonly 422: components["responses"]["UnprocessableEntity"];
            readonly 429: components["responses"]["TooManyRequests"];
        };
    };
    readonly listEvents: {
        readonly parameters: {
            readonly query: {
                readonly campusId: components["parameters"]["RequiredCampusQuery"];
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                /** @description Inclusive local calendar date; must be supplied together with `to`. */
                readonly from?: components["parameters"]["FromDate"];
                readonly limit?: components["parameters"]["Limit"];
                /** @description Inclusive local calendar date; must be supplied together with `from`. */
                readonly to?: components["parameters"]["ToDate"];
            };
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of events */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly ETag: components["headers"]["ETag"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["EventPage"];
                };
            };
            readonly 304: components["responses"]["LiveCatalogNotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 410: components["responses"]["CursorExpired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ConnectorUnavailable"];
        };
    };
    readonly getHealth: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description HTTP process is live */
            readonly 200: {
                headers: {
                    readonly "Cache-Control"?: "no-store";
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Health"];
                };
            };
            readonly 500: components["responses"]["InternalServerError"];
        };
    };
    readonly joinLiveEvent: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly eventId: components["parameters"]["EventIdPath"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["LiveEventJoinRequest"];
            };
        };
        readonly responses: {
            /** @description Short-lived join ticket */
            readonly 200: {
                headers: {
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorldJoinTicket"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 422: components["responses"]["UnprocessableEntity"];
            readonly 429: components["responses"]["TooManyRequests"];
        };
    };
    readonly listMessages: {
        readonly parameters: {
            readonly query?: {
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: components["parameters"]["Limit"];
            };
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of private messages */
            readonly 200: {
                headers: {
                    readonly ETag: components["headers"]["ETag"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MessagePage"];
                };
            };
            readonly 304: components["responses"]["NotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
        };
    };
    readonly createMessage: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateMessage"];
            };
        };
        readonly responses: {
            /** @description Message accepted for delivery */
            readonly 201: {
                headers: {
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Message"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 409: components["responses"]["Conflict"];
            readonly 422: components["responses"]["UnprocessableEntity"];
            readonly 429: components["responses"]["TooManyRequests"];
        };
    };
    readonly listModerationCases: {
        readonly parameters: {
            readonly query?: {
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: components["parameters"]["Limit"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of moderation cases */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ModerationCasePage"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
        };
    };
    readonly readPersonalVault: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description One strong ETag returned by a previous personal-vault response. */
                readonly "If-None-Match"?: components["parameters"]["VaultIfNoneMatch"];
                /**
                 * @description Canonical unpadded base64url JSON containing a short-lived single-use
                 *     `VaultReadProofV2`. This proves possession of an authorization private key; it is
                 *     independent from the OAuth DPoP credential and is consumed before a possible 304 response.
                 */
                readonly "X-Vault-Read-Proof": components["parameters"]["VaultReadProof"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current account-bound encrypted vault snapshot */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly ETag: components["headers"]["StrongETag"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["VaultSyncSnapshotV2"];
                };
            };
            readonly 304: components["responses"]["VaultNotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 428: components["responses"]["PreconditionRequired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly createPersonalVault: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Vault creation is allowed only when no vault exists. */
                readonly "If-None-Match": components["parameters"]["VaultCreateIfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["VaultCreateCommandV2"];
            };
        };
        readonly responses: {
            /** @description Genesis vault snapshot */
            readonly 201: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly ETag: components["headers"]["StrongETag"];
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly Location?: "/v1/personal/vault";
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["VaultSyncSnapshotV2"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 412: components["responses"]["PreconditionFailed"];
            readonly 413: components["responses"]["PayloadTooLarge"];
            readonly 415: components["responses"]["UnsupportedMediaType"];
            readonly 428: components["responses"]["PreconditionRequired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly bootstrapPersonalVault: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Account binding and minimal personal-vault existence metadata */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonalVaultBootstrapV2"];
                };
            };
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly listPersonalVaultDevicePairings: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description One strong ETag returned by a previous personal-vault response. */
                readonly "If-None-Match"?: components["parameters"]["VaultIfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Pairing requests owned by the authenticated account */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly ETag: components["headers"]["StrongETag"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DevicePairingPageV2"];
                };
            };
            readonly 304: components["responses"]["VaultNotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly createPersonalVaultDevicePairing: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Exactly one strong ETag returned by the current vault snapshot. Weak validators, wildcard
                 *     validators, and comma-separated validator lists are rejected.
                 */
                readonly "If-Match": components["parameters"]["VaultIfMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["DevicePairingRequestV2"];
            };
        };
        readonly responses: {
            /** @description Pending device-pairing request */
            readonly 201: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly ETag: components["headers"]["StrongETag"];
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly Location?: string;
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DevicePairingViewV2"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 412: components["responses"]["PreconditionFailed"];
            readonly 413: components["responses"]["PayloadTooLarge"];
            readonly 415: components["responses"]["UnsupportedMediaType"];
            readonly 428: components["responses"]["PreconditionRequired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly cancelPersonalVaultDevicePairing: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Exactly one strong ETag returned by the current vault snapshot. Weak validators, wildcard
                 *     validators, and comma-separated validator lists are rejected.
                 */
                readonly "If-Match": components["parameters"]["VaultIfMatch"];
            };
            readonly path: {
                readonly pairingId: components["parameters"]["PairingIdPath"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cancelled pairing representation */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": components["headers"]["NoStore"];
                    readonly ETag: components["headers"]["StrongETag"];
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DevicePairingViewV2"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 412: components["responses"]["PreconditionFailed"];
            readonly 428: components["responses"]["PreconditionRequired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly approvePersonalVaultDevicePairing: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Exactly one strong ETag returned by the current vault snapshot. Weak validators, wildcard
                 *     validators, and comma-separated validator lists are rejected.
                 */
                readonly "If-Match": components["parameters"]["VaultIfMatch"];
            };
            readonly path: {
                readonly pairingId: components["parameters"]["PairingIdPath"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PairingApprovalRequestV2"];
            };
        };
        readonly responses: {
            readonly 200: components["responses"]["VaultSnapshotMutationSucceeded"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 412: components["responses"]["PreconditionFailed"];
            readonly 413: components["responses"]["PayloadTooLarge"];
            readonly 415: components["responses"]["UnsupportedMediaType"];
            readonly 428: components["responses"]["PreconditionRequired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly updatePersonalVaultPayload: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Exactly one strong ETag returned by the current vault snapshot. Weak validators, wildcard
                 *     validators, and comma-separated validator lists are rejected.
                 */
                readonly "If-Match": components["parameters"]["VaultIfMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["VaultUpdatePayloadCommandV2"];
            };
        };
        readonly responses: {
            readonly 200: components["responses"]["VaultSnapshotMutationSucceeded"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 412: components["responses"]["PreconditionFailed"];
            readonly 413: components["responses"]["PayloadTooLarge"];
            readonly 415: components["responses"]["UnsupportedMediaType"];
            readonly 428: components["responses"]["PreconditionRequired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly rotatePersonalVaultKey: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Exactly one strong ETag returned by the current vault snapshot. Weak validators, wildcard
                 *     validators, and comma-separated validator lists are rejected.
                 */
                readonly "If-Match": components["parameters"]["VaultIfMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["VaultRotateKeyCommandV2"];
            };
        };
        readonly responses: {
            readonly 200: components["responses"]["VaultSnapshotMutationSucceeded"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 401: components["responses"]["Unauthorized"];
            readonly 403: components["responses"]["Forbidden"];
            readonly 404: components["responses"]["NotFound"];
            readonly 409: components["responses"]["Conflict"];
            readonly 412: components["responses"]["PreconditionFailed"];
            readonly 413: components["responses"]["PayloadTooLarge"];
            readonly 415: components["responses"]["UnsupportedMediaType"];
            readonly 428: components["responses"]["PreconditionRequired"];
            readonly 500: components["responses"]["InternalServerError"];
            readonly 503: components["responses"]["ServiceUnavailable"];
        };
    };
    readonly listPlaces: {
        readonly parameters: {
            readonly query?: {
                readonly campusId?: components["parameters"]["CampusQuery"];
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: components["parameters"]["Limit"];
                readonly query?: string;
            };
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of places */
            readonly 200: {
                headers: {
                    readonly ETag: components["headers"]["ETag"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PlacePage"];
                };
            };
            readonly 304: components["responses"]["NotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 503: components["responses"]["ConnectorUnavailable"];
        };
    };
    readonly calculateRoute: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Unique opaque key retained for 24 hours; reuse with a different body returns 409. */
                readonly "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RouteRequest"];
            };
        };
        readonly responses: {
            /** @description Route result */
            readonly 200: {
                headers: {
                    readonly "Idempotency-Replayed": components["headers"]["IdempotencyReplayed"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RouteResult"];
                };
            };
            readonly 400: components["responses"]["BadRequest"];
            readonly 409: components["responses"]["Conflict"];
            readonly 422: components["responses"]["UnprocessableEntity"];
            readonly 503: components["responses"]["ConnectorUnavailable"];
        };
    };
    readonly listSources: {
        readonly parameters: {
            readonly query?: {
                readonly campusId?: components["parameters"]["CampusQuery"];
                /** @description Integrity-protected opaque cursor returned as nextCursor; clients must not parse or modify it. */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: components["parameters"]["Limit"];
            };
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Cursor page of source descriptors */
            readonly 200: {
                headers: {
                    readonly ETag: components["headers"]["ETag"];
                    readonly "X-Request-Id": components["headers"]["RequestId"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SourcePage"];
                };
            };
            readonly 304: components["responses"]["NotModified"];
            readonly 400: components["responses"]["BadRequest"];
            readonly 500: components["responses"]["InternalServerError"];
        };
    };
    readonly getWorldManifest: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Conditional request validator from a previous ETag response. */
                readonly "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            readonly path: {
                readonly campusId: components["parameters"]["CampusPath"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description World manifest; verificationState controls product labeling */
            readonly 200: {
                headers: {
                    readonly "Cache-Control"?: string;
                    readonly ETag: components["headers"]["ETag"];
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CampusWorldManifest"];
                };
            };
            readonly 304: components["responses"]["NotModified"];
            readonly 404: components["responses"]["NotFound"];
            readonly 500: components["responses"]["InternalServerError"];
        };
    };
}
