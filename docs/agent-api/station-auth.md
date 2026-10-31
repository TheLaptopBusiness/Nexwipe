# Station authentication — current design and limitations

## Design (implemented and tested)

| Element | Implementation |
|---|---|
| Enrollment | Owner/admin (in a two-step verified session) creates a single-use enrollment token (`ndenr_…`, 1–168 h expiry, revocable). Only its SHA-256 hash is stored. `POST /enroll` consumes it atomically and returns a per-station credential once. |
| Credential | `ndagt_` + 32 random bytes (hex). Stored server-side only as SHA-256; the first 14 characters are kept as a display prefix. Never readable by app users (no table grants), never logged (request logs redact it). |
| Request authentication | `Authorization: Bearer <credential>` over HTTPS, plus `X-ND-Timestamp` (±300 s) and `X-ND-Nonce` (single use, retained 15 min). |
| Replay protection | Nonce uniqueness per station (database unique key) + timestamp window. A captured request cannot be replayed; it must be re-signed with a new nonce, which requires the credential. |
| Duplicate submissions | Per-job `seq` + `idempotency_key`; evidence by key + SHA-256. Retried requests return the original outcome. |
| Revocation | Owner/admin revokes a station → credential row revoked, station status `revoked`; queued jobs return to *awaiting authorization*, running jobs become *interrupted*. Every later request returns 401. |
| Tenant isolation | Every agent RPC resolves the organization from the authenticated station, never from the request. Jobs, evidence, reconciliation and inventory matching are filtered by `agent_id`/`org_id`; another organization's job IDs return 404. |
| Least privilege | Agent RPCs are executable only by the server (service role); browsers cannot call them. Stations never receive backend keys. |

Verified by: `tests/db/phase2_acceptance.sql`, `tests/db/phase2b_security.sql`, `scripts/agent-contract-check.ts` (18 HTTP checks, transcript in `transcript.md`).

## Limitations (must be addressed before production use)

1. **Bearer credential, not a signature.** The credential is sent on every request. Anyone who obtains it (e.g. from an unprotected boot USB) can act as that station until it is revoked. The nonce prevents replay of *captured requests*, not misuse of a *stolen credential*. Planned: per-station keypair generated on the station (ideally sealed in the laptop's or USB's TPM/secure element is not available on boot media — see handoff), Ed25519 request signatures over method + path + timestamp + nonce + body hash, or mutual TLS.
2. **No credential rotation endpoint yet.** Rotation today = revoke + re-enroll.
3. **Credential at rest on the boot medium.** The handoff requires an encrypted credential file bound to the medium serial; this is an agent-side responsibility and is not verified by the server.
4. **No station attestation.** The server cannot prove the request comes from an unmodified NextDrive image. Signed images + measured boot are planned (see handoff).
5. **Clock dependency.** Stations without a correct clock fail the ±300 s window; the agent must sync time (NTP or `GET /health` server_time offset).
6. **Rate limiting** relies on the hosting platform; no per-station rate limit is implemented.
7. **Enrollment token in transit to the station** is handled by people (typed or QR). Tokens are short-lived and single-use to limit exposure.
