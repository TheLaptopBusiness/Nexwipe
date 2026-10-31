# Station authentication and credential security

Two different problems need two different protections:

| Threat | What it means | Protection today | Planned |
|---|---|---|---|
| **A. Request forgery / replay** — someone captures or alters a request in transit | Network attacker, logging proxy, replayed HTTP request | HTTPS (TLS) on every request; per-request `X-ND-Timestamp` (±300 s) and single-use `X-ND-Nonce` stored 15 min; idempotency keys + monotonic `seq` for job events | Request signatures (Ed25519 over method, path, timestamp, nonce, body hash) or mutual TLS, so a captured request is useless even if TLS is intercepted |
| **B. Stolen credential** — someone copies the station's secret (e.g. from a lost USB stick) | Attacker can make *new* valid requests as that station | Short lifetime (90-day expiry), rotation, immediate revocation, read-only stations cannot run jobs, credential encrypted on the stick and bound to that stick | Non-exportable key storage (TPM-sealed key on the laptop is not possible for a roaming boot stick; see "Key storage" below), anomaly alerts |

**Signed requests alone do not solve B.** If an attacker copies the private signing key, they can sign requests just as the station does. Signing protects requests in transit; only key storage that prevents copying, plus expiry, rotation and revocation, limit a stolen key.

## A. Request authentication (implemented and tested)

- `Authorization: Bearer ndagt_…` — the credential is sent over TLS only; the server stores only its SHA-256.
- `X-ND-Timestamp` must be within ±300 s; `X-ND-Nonce` must be new for that station (unique index). Captured requests cannot be replayed.
- Every job write carries `seq` and an `idempotency_key`; duplicates return the original outcome, conflicting reuse is rejected.
- Tested: `tests/db/phase2_acceptance.sql`, `phase2b_security.sql`, `scripts/agent-contract-check.ts` (replay → 409, stale timestamp → 401, missing nonce → 401, unknown credential → 401).

## B. Stolen-credential limits (implemented and tested)

| Control | Behaviour |
|---|---|
| **Enrollment** | Single-use token, default lifetime 1 hour (max 7 days), created only by an owner/admin in a two-step-verified session. Stored hashed. |
| **Expiration** | Each credential expires 90 days after issue (`agent_credentials.expires_at`). Expired credentials are rejected with 401. Heartbeat responses include `credential_expires_at`. |
| **Rotation** | `POST /credentials/rotate` issues a new credential (90 days) and shortens the old one to a 10-minute grace window so a lost response does not lock the station out. A credential can be rotated once; heartbeat sets `rotate_recommended: true` when < 14 days remain and the station rotates automatically. |
| **Revocation** | Owner/admin revokes in **Agents & stations**. All of the station's credentials stop working immediately (station status checked on every request); queued jobs return to awaiting authorization, running jobs become interrupted. The station deletes its local copy when it sees 401. |
| **Read-only stations** | Every physical station enrolled today is a *read-only test station*: it can enroll, heartbeat and report hardware, but the database refuses to authorize it for any job or accept job events/evidence from it. A stolen read-only credential can at worst upload false hardware reports, which a technician must still accept, and which are labelled as station reports. Only trusted server code (not app users) can change a station out of read-only mode. |
| **Blast radius** | A credential works only for its own organization; job and evidence endpoints only see jobs bound to that station. Backend keys never leave the server. |
| **At-rest protection on the stick** | Credential file encrypted (Fernet/AES-128-CBC + HMAC) with a key derived from the boot stick's serial number and the state partition's UUID; mounted `noexec,nosuid,nodev`; file mode 0600. A copied state file does not decrypt on another stick. **Limitation:** whoever holds the original stick can still boot it and use the credential until revoked. |

Tested: `tests/db/phase2c_readonly_stations.sql` (18 checks: read-only enforcement, expiry, rotation, grace window, single rotation, revocation of rotated credentials), contract check steps 4–8 and 21–23, VM checklist step 8.

## Key storage — planned approach

1. **Per-station Ed25519 keypair generated on the station at enrollment**; the server stores only the public key. Replaces the bearer secret (request signing).
2. **Hardware-backed storage where available:** a USB security key (FIDO2/PIV token, e.g. YubiKey) permanently attached to each station stick holds the private key; it signs but never exports the key. Copying the USB stick then copies nothing useful. (A laptop's own TPM cannot be used because the station boots many different laptops.)
3. **Without a hardware token:** keep today's encrypted-at-rest approach, plus a short credential lifetime (e.g. 30 days) and mandatory rotation.
4. **Operational controls:** stations are physically tracked like keys; lost sticks are revoked the same day; the dashboard shows last-seen time and last IP per station (planned), and alerts on use from an unexpected network (planned).

## Remaining limitations

- Bearer credential, not a signature (A-planned).
- No hardware-backed key storage yet (B-planned).
- No station image attestation: the server cannot prove a request comes from an unmodified NexWipe image.
- Rate limiting relies on the hosting platform.
