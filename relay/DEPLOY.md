# Deployment — git-connected (live 2026-09-27)

The `hands-relay` Worker deploys automatically from GitHub: pushing to
`burnt424-oss/hands` branch `main` triggers a Cloudflare build
(root directory `relay/`, no build command, `npx wrangler deploy`).
`relay/wrangler.toml` carries the worker name, entry point, and the
`RELAY_KV` binding (namespace id must match the dashboard).
The `RELAY_SECRET` secret and `RELAY_KV` binding are managed in the
dashboard (Worker → Settings) and persist across git deploys.
Dashboard: https://dash.cloudflare.com/ → Workers & Pages → hands-relay.
Public URL: https://hands-relay.burnt424.workers.dev

To deploy a relay change: edit `relay/worker.js`, push to main, watch the
Deployments tab. Verify unauthenticated fetch returns
401 {"error":"unauthorized"}.

One-time setup (done 2026-09-27, kept for reference):

1. Cloudflare Dashboard → Workers & Pages → Create Worker named `hands-relay`.
   Paste `worker.js` and deploy.
2. Under Workers → KV, create namespace `hands-relay`. Open the Worker →
   Settings → Bindings → Add KV namespace binding, variable name `RELAY_KV`,
   selecting that namespace. Save/deploy the binding.
3. Worker → Settings → Variables and Secrets: add a **secret** named
   `RELAY_SECRET`. Set its value to the lowercase hex representation of the
   existing 32-byte `~/workspace/hands/.key` (64 hex characters). The existing
   file is binary, not text. Transfer it privately; never commit it, paste it
   in chat, or embed it in worker.js/APKs. Save/deploy the secret.
4. Note the public URL `https://hands-relay.<subdomain>.workers.dev`.
5. With an authenticated HTTP client, verify missing auth gives 401, then
   POST /cmd and GET /poll?since=0, POST /res and GET /result?id=... . Use
   disposable test IDs and opaque dummy blobs. Allow for KV propagation.
6. Write that base URL (no trailing slash) into `~/workspace/hands/.relay_url`.
   This file is deliberately NOT created during staging. Removing it restores
   the Python driver's webhook.site transport.
7. Only after the relay works, prepare the usual release metadata/APK:
   versionCode 13, versionName 0.3.0, the APK URL, notes, and optional
   `"relayUrl": "https://hands-relay.<subdomain>.workers.dev"` in version.json.
   Publish using the normal project release process when authorized. Nothing
   in this staging run publishes metadata, uploads the APK, or drives the phone.
8. Brent installs v0.3.0 with the existing signing key and opens Hands. A
   successful version.json fetch saves relayUrl even without a newer app
   version. Coordinate a phone smoke test separately, including a large screen
   result, restart, results/listen, and fallback.

## Transport compatibility

The clients retain AES-GCM, gzip and the existing chunk envelope fields. Each
command chunk occupies one queue entry, whose blob is the original envelope
JSON. Results store an opaque JSON string containing the original envelope
array under the command ID. The Python adapter feeds those envelopes into the
existing chunk reassembly loop. `.relay_pending` remembers command IDs across
CLI invocations for results/listen; it contains IDs and timestamps, no keys.
The phone polls since=0 and uses its existing persistent seen IDs to avoid
replays and tolerate delayed KV visibility. All relay requests carry Bearer
auth derived from the existing key. No additional pairing is needed.

A nonempty HTTPS relayUrl is saved in existing app preferences. Missing/empty
metadata retains the last saved URL; a fresh installation without a saved URL
uses the compiled webhook.site default. For rollback after migration, publish
relayUrl as `https://webhook.site` (clients treat that as legacy transport).

## Limits to verify before relying on this relay

KV is eventually consistent, and this specified single-key queue is not an
atomic queue: concurrent/stale read-modify-write operations can lose commands.
Sequential local KV mocks cannot reproduce this. Retries with the same ID are
deduplicated only when the write is visible. Queue capacity is 200 envelopes;
all queue/result writes use a seven-day TTL. KV write-rate and free-tier KV
quotas also matter, independently of the Workers request quota. This build
makes no guarantee of lossless delivery or $0 under every workload. Strong
queue ordering would need a different storage design (for example a Durable
Object), outside tonight's requested Worker + KV implementation.
