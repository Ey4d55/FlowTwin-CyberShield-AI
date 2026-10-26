# FlowTwin CyberShield AI

An executable proof of concept for cyber-resilient traffic infrastructure, prepared for IS CyberNext 2026. A standalone project with a browser demonstration and an authenticated local server.

## Start

Requires Node.js 22 or later. No npm install is needed for the application or core/server tests.

```sh
npm start
```

Open http://127.0.0.1:4186. The local server creates a random operator password in `.local/operator-password.txt`. Enter it through **Operator access** to authorize actions. Alternatively set `CYBERSHIELD_OPERATOR_PASSWORD` before startup. Secrets, persistent state, sessions, and test images are excluded from Git. The server binds to localhost and is not a production internet service.

For a static demonstration, serve `docs/` using an HTTP static server or GitHub Pages. Do not open `index.html` as a file URL: modules, Web Crypto and service workers require an appropriate origin. Public Pages hosts the browser sandbox, not the Node server.

## What works

| Capability | Executable implementation |
| --- | --- |
| Vehicle detection | Bundled TensorFlow.js 4.22.0 + pretrained COCO-SSD 2.2.3 / SSDLite MobileNet v2 detect cars, buses, trucks and motorcycles in uploaded images, entirely on the device. |
| Traffic analysis | Eight synthetic camera/loop sources on four approaches; queue and count aggregation; explainable 60-second queue projection. |
| Cyber monitoring | HMAC failure, replay/out-of-order sequence, stale/future timestamp, malformed or out-of-bounds data, independent-source disagreement, and rolling statistical shift detection. |
| Data integrity | Per-source HMAC-SHA256 over canonical envelopes. Failed and low-trust inputs do not enter the traffic model. |
| Secure digital twin | Deterministic aggregate queue simulation, matched seeded arrivals, current versus candidate timing, explicit assumptions, and visible unfavorable outcomes. |
| Human review | Propose, approve or reject timing/isolation/release; 60-second expiry; security-state binding; trust recheck; timing limits; all-red startup clearance. |
| Server authorization | Password-backed, expiring HttpOnly / SameSite sessions; authorization is checked on the server for mutations. Cross-origin mutations and non-JSON writes are blocked; login attempts are rate limited. |
| Edge resilience | Local engine, browser IndexedDB or server disk persistence, service-worker offline shell; model assets cache after loading; a modeled cloud uplink buffers and drains events. |
| Audit | SHA-256 chained immutable snapshots, chain verification, JSON evidence export, imported-export verification. |
| Interface | English and Arabic, responsive layouts, operations/trust/twin/review/vision/audit/briefing workspaces. |

## Demonstrate it

1. **Operations:** select Message tampering. A payload changes after signing. Its real HMAC check fails and the camera is removed from trusted inputs.
2. **Data trust:** inspect the explanation. Propose isolation for CAM-N.
3. **Response review:** enter operator mode and approve. On the Node server, the generated password is mandatory. On public Pages, this is explicitly a demo role, not authentication.
4. **Operations:** try replay, conflicting sensors, invalid sensor readings, and delayed telemetry. Each scenario exercises the actual corresponding rule.
5. **Digital twin:** select rush-hour congestion and compare plans. Request timing review. Approve within 60 seconds while security conditions remain unchanged. The simulated controller begins with a five-second all-red clearance.
6. **Audit:** verify the chain and export evidence. Edit a record in the export and import it to see verification fail.
7. **Vehicle detection:** load the local model and choose an image. Images are neither uploaded nor converted into authenticated traffic observations. Bounding boxes, class counts and inference duration appear.
8. **Offline:** after the service worker activates, disconnect browser networking and reload. Local monitoring and cached image inference remain available once their assets have loaded. The cloud-outage scenario is a separate, explicitly modeled uplink test.

## Architecture

```text
Registered source -> HMAC / sequence / timestamp / range checks
                  -> peer and statistical checks -> trust filter
                  -> queue projection -> matched-demand digital twin
                  -> expiring proposal -> authorized operator
                  -> recheck safety -> simulated controller / source isolation
Every accepted input, rejection, alert and decision -> SHA-256 audit chain
```

`docs/core.js` is shared by the browser and Node. `docs/app.js` owns the UI. `server/server.mjs` keeps source keys server-side, enforces operator sessions, serializes state-changing operations and persists the engine. The static browser sandbox stores its own demo keys locally; it provides no security boundary against its own user.

The optional `POST /api/ingest` endpoint receives `{sourceId,seq,timestamp,payload:{count,speed,queue},signature}`. `count` is vehicles/minute, `speed` is km/h and `queue` is vehicles. `seq` is a monotonically increasing integer. `signature` is lowercase hexadecimal HMAC-SHA256 over the recursively key-sorted JSON envelope excluding `signature`. Source keys must be provisioned through a protected process for external equipment; no public provisioning endpoint is exposed. External devices, MQTT brokers and municipal systems are not connected in this PoC.

## Model and security limits

- Default traffic data is generated locally. Uploaded-image inference is real, but it is single-frame detection, not video tracking, speed estimation, queue inference, or trusted camera provenance.
- Traffic prediction is a fixed-assumption queue projection, not a trained or field-validated model. Cyber detection uses statistical and deterministic rules, not a trained attack classifier. Alerts are explanations for investigation, not proof of attribution.
- A valid HMAC proves possession of a source key and message integrity; it does not prove sensor truth. Shared-key compromise and a compromised edge host require additional defenses.
- Twin assumptions: four aggregate approaches; 180-second horizon; 0.65 veh/s discharge during compatible green; 3-second amber plus 2-second all-red transitions. Timing has 15–45-second green bounds per axis and 60-second total green. No turning geometry, pedestrians, physical collision model or traffic safety certification.
- A change of security state invalidates pending approvals. Release resets trust to 50 and requires new valid readings before reuse. Source conflicts require operator investigation.
- “Cloud outage” is a simulated uplink. There is no real external synchronization destination. Its drained counter is a model result, not confirmed remote delivery. Browser offline caching is independently testable.
- Audit snapshots are hashed and chained. Without external anchoring, an attacker controlling storage can replace a complete chain or truncate its tail. Save exported heads independently when comparing evidence.
- Public Pages offers a demo operator workflow only. Real server authorization is demonstrated locally. The local server is HTTP on loopback; production would require TLS, managed identity, proper source provisioning and rotation, durable remote audit, access logging and infrastructure-specific safety integration.

## Verification

```sh
npm run check
npm test
```

Tests cover HMAC tampering, replay, malformed and stale inputs, sensor disagreement, source isolation/recovery, data freshness, audit snapshot stability and tamper detection, deterministic twin arrivals and vehicle conservation, phase clearance, operator authorization, proposal expiry/security changes, cloud buffering, HTTP auth boundaries, login limiting and restart persistence.

Browser checks additionally exercise the whole approval workflow, English/Arabic/mobile layouts, an actual image with a detected bus, network-offline reload and inference, and server-backed operator login:

```sh
# Install Playwright as a local development tool if it is not provided by your environment.
npm install --no-save playwright
# Requires Google Chrome installed, or adjust tests/browser.mjs to your browser installation.
npm run test:ui
```

Alternatively set `CYBERSHIELD_NODE_MODULES` to a directory containing Playwright. Browser screenshots and exported test evidence go to ignored `test-results/`; the compact verification receipt is in `evidence/`.

## Bundled model assets and licensing

Model scripts and weights are pinned and included locally. `scripts/vendor-model.mjs` refreshes them; `evidence/model-assets.json` records original URLs and SHA-256 checksums. TensorFlow / COCO-SSD licenses are in `docs/vendor/`. Font OFL licenses are in `docs/fonts/`. Tests download an upstream bus photograph into ignored `.local/` for inference validation; that photograph is not redistributed by the site.

Primary references: [COCO-SSD model API](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), [Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto), [GitHub Pages configuration](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
