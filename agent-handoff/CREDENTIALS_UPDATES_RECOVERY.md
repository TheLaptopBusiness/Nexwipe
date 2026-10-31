# Credentials, revocation, updates and recovery

## Credential storage

- Enrollment: technician enters the `ndenr_…` token on the console (or scans a QR code shown in the web app). Token is held only in memory.
- The returned `ndagt_…` credential is written to the station's small writable state partition, **encrypted** with a key derived from (a) a per-image secret and (b) the boot medium's own serial + partition UUID (HKDF-SHA256). Copying the state file to another USB stick then fails to decrypt. This is defense in depth, not strong protection: anyone holding the original stick holds the credential. Document this to customers; physical custody of station sticks matters.
- File permissions 0600, owned by the `nd-agent` user; the engine never reads it.
- Never print the credential on screen or in logs; show only the prefix (`ndagt_ab12cd34…`).

## Revocation

- Any 401 with message "revoked" → delete the credential file, stop all work, show "This station has been revoked. Re-enroll to continue." Any in-progress destructive command already issued to the device continues in hardware; the agent reports nothing further until re-enrolled. The server has already marked such jobs interrupted.
- Lost/stolen station medium → owner revokes it in **Agents & stations**.

## Signed software updates

- Updates are whole-image replacements, never in-place package updates.
- Release artifacts: image + SHA-256 + detached signature (minisign/Ed25519, or Sigstore). Public key baked into the image. The agent verifies the signature before writing the new image to the inactive A/B slot of the stick, then switches slot on next boot; on failed boot it falls back.
- The server will publish allowed versions (planned `agent_releases`); until then the agent reports `agent_version` and the cloud shows it on the stations page.
- Debug and release keys are different; debug images are rejected by release images.

## Network interruption and restart recovery

- The agent keeps an append-only local event log (JSON lines, fsync after each write) with `job_id`, `seq`, `idempotency_key`, body, and send status.
- Sending: retry with exponential backoff (1 s → 60 s, jitter), same key and body, **new nonce and timestamp** each attempt.
- After any reconnect or reboot: `POST /reconcile` with every local job and its highest logged seq; follow the instruction table in `CONTRACT.md §6`.
- If the device itself reports an in-progress sanitize after reboot, wait for completion, then report the device-reported outcome — never assume success.
- If local state is lost (new stick, corrupted log): reconcile with an empty list; jobs come back as `report_state`/`stop`; the engine re-reads device status and reports honestly, otherwise the job stays interrupted for a human.
- Heartbeat every 30 s while booted; server interrupts jobs after 180 s of silence.
