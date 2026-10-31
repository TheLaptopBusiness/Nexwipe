# NextDrive Agent API — example requests

Base URL: `https://<your-app>/api/public/agent/v1`. Authoritative contract: [`CONTRACT.md`](./CONTRACT.md). Spec: [`openapi.yaml`](./openapi.yaml). Exact captured requests/responses: [`transcript.md`](./transcript.md).

```bash
BASE=https://<your-app>/api/public/agent/v1
H() { echo -H "x-nd-timestamp: $(date -u +%s)" -H "x-nd-nonce: $(openssl rand -hex 16)"; }
```

## 1. Enroll (once per station)
An owner/admin creates a token in **Agents & stations → Enrollment token**.
```bash
curl -s -X POST $BASE/enroll -H 'content-type: application/json' \
  -d '{"enrollment_token":"ndenr_…","name":"Bench 3","agent_version":"0.1.0","platform":"x86_64 live image"}'
# 201 {"agent_id":"…","credential":"ndagt_…","heartbeat_interval_seconds":30}
CRED=ndagt_…
```

## 2. Heartbeat and inventory
```bash
curl -s -X POST $BASE/heartbeat $(H) -H "authorization: Bearer $CRED" -H 'content-type: application/json' -d '{"state":"idle"}'
curl -s -X POST $BASE/inventory $(H) -H "authorization: Bearer $CRED" -H 'content-type: application/json' \
  -d '{"system":{"manufacturer":"Dell","model":"Latitude 5420","serial":"7XK2Q93"},
       "drives":[{"serial":"S5H9NX0R123456","model":"Samsung PM991","interface":"nvme_ssd","capacity_bytes":512110190592,"firmware":"5L2QFXV7"}]}'
```

## 3. Get authorized jobs
```bash
curl -s $BASE/jobs $(H) -H "authorization: Bearer $CRED"
# {"jobs":[{"job_id":"…","next_seq":1,"authorization":{"id":"…","expires_at":"…"},
#           "target":{"asset_tag":"UTS-00412","drive_serial":"S5H9NX0R123456",…},
#           "policy":{"allowed_methods":["nvme_sanitize_crypto"],"verification_method":"full_read","require_evidence":true}}]}
```

## 4. Local confirmation + acknowledge (seq 1)
The station shows asset tag and drive serial; the operator types the last 4 characters (`3456`).
```bash
curl -s -X POST $BASE/jobs/$JOB/ack $(H) -H "authorization: Bearer $CRED" -H 'content-type: application/json' \
  -d '{"seq":1,"idempotency_key":"ack-7f3a9c01","authorization_id":"'$AUTH'",
       "observed":{"system_serial":"7XK2Q93","drive_serial":"S5H9NX0R123456"},
       "local_confirmation":{"confirmed":true,"typed_serial_suffix":"3456","operator":"J. Smith"}}'
# 200 {"ok":true,"proceed":true,"allowed_methods":["nvme_sanitize_crypto"],"job_status":"running","last_seq":1}
# 409 {"error":{"code":"drive_identity_mismatch",…}}  -> do NOT execute; job quarantined
```

## 5. Progress (seq 2…)
```bash
# Measured progress
-d '{"seq":2,"idempotency_key":"prg-0002aa","type":"progress","phase":"Sanitize","measured":true,"progress_pct":42}'
# Phase only (no measurement available)
-d '{"seq":3,"idempotency_key":"prg-0003aa","type":"progress","phase":"Waiting for controller","measured":false}'
```

## 6. Execution result, evidence, verification result
```bash
curl … $BASE/jobs/$JOB/result -d '{"seq":4,"idempotency_key":"exe-0004aa","stage":"execution","outcome":"succeeded","method":"nvme_sanitize_crypto","detail":{"sanitize_status":"0x0101"}}'
SHA=$(printf '%s' "$LOG" | sha256sum | cut -d' ' -f1)
curl … $BASE/jobs/$JOB/evidence -d '{"idempotency_key":"evi-0001aa","kind":"verification_log","filename":"verify.log","content":"…","sha256":"'$SHA'"}'
curl … $BASE/jobs/$JOB/result -d '{"seq":5,"idempotency_key":"ver-0005aa","stage":"verification","outcome":"passed","method":"full_read"}'
# job_status: awaiting_validation  (a reviewer must approve in the app)
```

## 7. Reconnect after a network drop
```bash
curl … $BASE/reconcile -d '{"jobs":[{"job_id":"'$JOB'","agent_last_seq":7}]}'
# {"jobs":[{"job_id":"…","server_last_seq":5,"instruction":"replay_from_server_seq"}]}
# Re-send seq 6 and 7 with their ORIGINAL idempotency keys and bodies; duplicates return duplicate:true.
```

## Error codes
| HTTP | code | Meaning |
|---|---|---|
| 401 | unauthorized | Bad/revoked credential, bad timestamp, missing nonce |
| 404 | not_found | Job not bound to this agent |
| 409 | sequence_conflict | `seq` ≠ server `last_seq + 1` (see `expected_seq`) |
| 409 | replayed_request | Nonce reused |
| 409 | conflict | Invalid transition, authorization used/revoked, idempotency key reused with different body, job closed |
| 409 | drive_identity_mismatch | Observed drive/system serial differs; job quarantined |
| 410 | authorization_expired | Technician must authorize again |
| 422 | validation_failed / unprocessable | Schema error, local confirmation missing, hash mismatch, evidence required |
