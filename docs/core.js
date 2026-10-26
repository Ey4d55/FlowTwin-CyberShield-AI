// Shared, dependency-free security and digital twin engine. Web Crypto in browser and Node.
export const VERSION = '1.0.0';
export const DIRECTIONS = ['N', 'E', 'S', 'W'];
export const SCENARIOS = {
  normal: { name: 'Normal operations', description: 'Signed camera and loop readings agree. All observations are synthetic.' },
  congestion: { name: 'Rush-hour congestion', description: 'North–south demand rises. Valid data supports a timing recommendation.' },
  tamper: { name: 'Message tampering', description: 'A camera count is changed after signing. HMAC verification rejects it.' },
  replay: { name: 'Replay attack', description: 'A previously signed packet is resent. Its sequence number is rejected.' },
  conflict: { name: 'Conflicting sensors', description: 'A correctly signed camera disagrees with its paired loop. A valid signature does not prove a truthful measurement.' },
  fault: { name: 'Sensor failure', description: 'A signed sensor reports physically invalid readings. Classified as a fault, not proof of an attack.' },
  stale: { name: 'Delayed telemetry', description: 'A signed reading arrives two minutes late. It is excluded from traffic decisions.' },
  outage: { name: 'Cloud uplink outage', description: 'The simulated uplink disconnects. Local verification, alerts, and simulation continue; events queue locally.' }
};
const encoder = new TextEncoder();
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export const hex = buffer => [...new Uint8Array(buffer)].map(n => n.toString(16).padStart(2, '0')).join('');
export async function sha(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(typeof value === 'string' ? value : canonical(value)))); }
export async function keyFrom(secret) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export function envelope(packet) { return { sourceId: packet.sourceId, seq: packet.seq, timestamp: packet.timestamp, payload: packet.payload }; }
export async function sign(packet, secret) { return { ...envelope(packet), signature: hex(await crypto.subtle.sign('HMAC', await keyFrom(secret), encoder.encode(canonical(envelope(packet))))) }; }
export async function verify(packet, secret) {
  if (!/^[a-f0-9]{64}$/.test(packet.signature || '')) return false;
  const bytes = new Uint8Array(packet.signature.match(/../g).map(v => parseInt(v, 16)));
  return crypto.subtle.verify('HMAC', await keyFrom(secret), bytes, encoder.encode(canonical(envelope(packet))));
}
export async function verifyAudit(entries) {
  let previousHash = '0'.repeat(64);
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...entry } = entries[i];
    if (entry.index !== i || entry.previousHash !== previousHash || await sha(entry) !== hash) return { valid: false, index: i };
    previousHash = hash;
  }
  return { valid: true, entries: entries.length, head: previousHash };
}
export function random(seed = 42) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
export function signalAt(time, plan = { ns: 30, ew: 30 }) {
  const cycle = plan.ns + plan.ew + 10, t = ((time % cycle) + cycle) % cycle;
  if (t < plan.ns) return { axis: 'NS', state: 'green', remaining: Math.ceil(plan.ns - t) };
  if (t < plan.ns + 3) return { axis: 'NS', state: 'amber', remaining: Math.ceil(plan.ns + 3 - t) };
  if (t < plan.ns + 5) return { axis: null, state: 'red', remaining: Math.ceil(plan.ns + 5 - t) };
  if (t < plan.ns + 5 + plan.ew) return { axis: 'EW', state: 'green', remaining: Math.ceil(plan.ns + 5 + plan.ew - t) };
  if (t < plan.ns + 8 + plan.ew) return { axis: 'EW', state: 'amber', remaining: Math.ceil(plan.ns + 8 + plan.ew - t) };
  return { axis: null, state: 'red', remaining: Math.ceil(cycle - t) };
}
export function forecast(readings) {
  const groups = DIRECTIONS.map(direction => {
    const observations = readings.filter(r => r.direction === direction);
    return { direction, count: observations.length, queue: observations.length ? observations.reduce((n, x) => n + x.queue, 0) / observations.length : null,
      rate: observations.length ? observations.reduce((n, x) => n + x.count, 0) / observations.length / 60 : null };
  });
  const unavailable = groups.some(g => g.count === 0);
  const queues = groups.map(g => g.queue ?? 0), rates = groups.map(g => g.rate ?? 0);
  const projected = queues.map((q, i) => Math.max(0, q + (rates[i] - 0.27) * 60));
  return { groups, queues, rates, projected, horizon: 60, unavailable, method: '60-second queue projection; fixed discharge assumption 0.27 vehicles/second per approach. Not a trained predictor.' };
}
export function simulateTwin(readings, { seed = 42, horizon = 180, plan = { ns: 30, ew: 30 } } = {}) {
  const f = forecast(readings);
  if (f.unavailable) return { available: false, reason: 'Fresh trusted observations are required for all four approaches.' };
  const ns = f.queues[0] + f.queues[2] + 30 * (f.rates[0] + f.rates[2]);
  const ew = f.queues[1] + f.queues[3] + 30 * (f.rates[1] + f.rates[3]);
  const candidate = { ns: Math.max(15, Math.min(45, Math.round(60 * ns / Math.max(1, ns + ew)))), ew: 0 };
  candidate.ew = 60 - candidate.ns;
  const rng = random(seed), arrivals = Array.from({ length: horizon }, () => f.rates.map(rate => {
    const base = Math.floor(rate); return base + (rng() < rate - base ? 1 : 0);
  }));
  function run(timing) {
    const queues = [...f.queues]; let waiting = 0, discharged = 0, arrived = 0;
    const trace = [];
    for (let t = 0; t < horizon; t++) {
      const signal = signalAt(t, timing);
      for (let i = 0; i < 4; i++) {
        queues[i] += arrivals[t][i]; arrived += arrivals[t][i];
        if (signal.state === 'green' && signal.axis === (i % 2 === 0 ? 'NS' : 'EW')) {
          const passed = Math.min(queues[i], 0.65); queues[i] -= passed; discharged += passed;
        }
      }
      waiting += queues.reduce((a, b) => a + b, 0);
      if (t % 10 === 0) trace.push({ t, queue: queues.reduce((a, b) => a + b, 0) });
    }
    return { waiting: Math.round(waiting), discharged: Math.round(discharged), arrived, initial: f.queues.reduce((a, b) => a + b, 0), finalQueue: queues.reduce((a, b) => a + b, 0), trace };
  }
  const baseline = run(plan), alternative = run(candidate);
  const improvement = baseline.waiting ? 100 * (baseline.waiting - alternative.waiting) / baseline.waiting : 0;
  return { available: true, seed, horizon, currentPlan: plan, candidate, baseline, alternative, improvement, recommended: improvement > 0.5,
    assumptions: 'Aggregate queues, identical seeded arrivals, 0.65 veh/s green discharge, 3 s amber + 2 s all-red per transition; no geometry, turns, pedestrians, or field calibration.' };
}

export class CyberShield {
  constructor({ clock = () => Date.now(), seed = 42 } = {}) {
    this.clock = clock; this.seed = seed; this.sources = new Map(); this.audit = []; this.alerts = []; this.proposals = [];
    this.tick = 0; this.scenario = 'normal'; this.uplink = true; this.pending = 0; this.synced = 0; this.securityVersion = 0;
    this.plan = { ns: 30, ew: 30 }; this.planStarted = this.clock(); this.stats = { received: 0, accepted: 0, rejected: 0 };
  }
  async register(id, direction, type, secret) {
    if (!DIRECTIONS.includes(direction) || this.sources.has(id)) throw new Error('Invalid or duplicate source');
    this.sources.set(id, { id, direction, type, secret, lastSeq: -1, generatedSeq: 0, lastSeen: null, trust: 100, status: 'waiting', quarantined: false, reading: null, history: [] });
  }
  async record(type, detail) {
    const entry = { index: this.audit.length, timestamp: this.clock(), type, detail: structuredClone(detail), previousHash: this.audit.at(-1)?.hash ?? '0'.repeat(64) };
    entry.hash = await sha(entry); this.audit.push(entry);
    if (this.uplink) this.synced++; else this.pending++;
    return entry;
  }
  async alert(source, code, message, kind, severity = 'high', evidence = {}) {
    const existing = this.alerts.find(a => a.sourceId === source.id && a.code === code && !a.resolved);
    if (existing) { existing.occurrences++; existing.lastSeen = this.clock(); return; }
    this.securityVersion++;
    const event = { id: crypto.randomUUID(), sourceId: source.id, code, message, kind, severity, evidence, timestamp: this.clock(), lastSeen: this.clock(), occurrences: 1, resolved: false };
    this.alerts.unshift(event); await this.record('ALERT', event);
  }
  async ingest(packet) {
    this.stats.received++;
    const source = this.sources.get(packet?.sourceId);
    if (!source) { this.stats.rejected++; await this.record('UNKNOWN_SOURCE', { sourceId: String(packet?.sourceId ?? '').slice(0, 80) }); return { accepted: false, code: 'UNKNOWN_SOURCE' }; }
    const reject = async (code, message, kind, evidence = {}) => {
      this.stats.rejected++; source.trust = Math.max(0, source.trust - (code === 'QUARANTINED' ? 0 : 35)); source.status = source.quarantined ? 'quarantined' : 'suspect';
      await this.alert(source, code, message, kind, code === 'QUARANTINED' ? 'medium' : 'high', evidence);
      await this.record('READING_REJECTED', { sourceId: source.id, code, seq: packet.seq ?? null }); return { accepted: false, code };
    };
    if (source.quarantined) return reject('QUARANTINED', 'Source is isolated. Its readings cannot drive traffic decisions.', 'isolation');
    if (!Number.isSafeInteger(packet.seq) || packet.seq < 0 || !Number.isFinite(packet.timestamp) || !packet.payload || typeof packet.payload !== 'object') return reject('SCHEMA', 'Malformed telemetry envelope.', 'fault');
    if (!await verify(packet, source.secret)) return reject('SIGNATURE', 'Message authentication failed. Payload or sender may have been altered.', 'suspected tampering');
    if (packet.seq <= source.lastSeq) return reject('REPLAY', 'Sequence number was already consumed or arrived out of order.', 'replay', { seq: packet.seq, lastSeq: source.lastSeq });
    const age = this.clock() - packet.timestamp;
    if (age > 15000 || age < -5000) return reject('TIMESTAMP', 'Telemetry is stale or has an invalid future timestamp.', 'timing anomaly', { ageMs: age });
    source.lastSeq = packet.seq; // Consume authenticated sequence even when its measurements are unsafe.
    const p = packet.payload;
    if (![p.count, p.speed, p.queue].every(Number.isFinite) || p.count < 0 || p.count > 250 || p.speed < 0 || p.speed > 160 || p.queue < 0 || p.queue > 200) return reject('RANGE', 'Reading is outside configured physical bounds; possible sensor fault.', 'fault', { count: p.count, speed: p.speed, queue: p.queue });
    const peer = [...this.sources.values()].find(s => s.direction === source.direction && s.id !== source.id && !s.quarantined && s.reading && this.clock() - s.lastSeen < 10000 && s.trust >= 70);
    if (peer && Math.abs(peer.reading.count - p.count) > 25) return reject('CONFLICT', 'Independent sensors disagree. Investigate both sources; a valid signature does not establish measurement truth.', 'data conflict', { observed: p.count, peerId: peer.id, peerCount: peer.reading.count });
    if (source.history.length >= 8) {
      const mean = source.history.reduce((s, x) => s + x, 0) / source.history.length;
      const sd = Math.sqrt(source.history.reduce((s, x) => s + (x - mean) ** 2, 0) / source.history.length);
      if (Math.abs(p.count - mean) > Math.max(35, 4 * sd)) await this.alert(source, 'SHIFT', 'Count shifted sharply from its rolling baseline. Could be real congestion, a fault, or manipulation.', 'statistical anomaly', 'medium', { count: p.count, mean, standardDeviation: sd });
    }
    source.reading = { count: p.count, speed: p.speed, queue: p.queue }; source.lastSeen = this.clock();
    source.history.push(p.count); if (source.history.length > 20) source.history.shift();
    source.trust = Math.min(100, source.trust + 2); source.status = source.trust >= 70 ? 'trusted' : 'recovering';
    this.stats.accepted++;
    // Each accepted input is auditable without retaining images or secrets.
    await this.record('READING_ACCEPTED', { sourceId: source.id, seq: packet.seq, reading: source.reading, trust: source.trust });
    return { accepted: true, trusted: source.trust >= 70 };
  }
  trustedReadings() {
    return [...this.sources.values()].filter(s => !s.quarantined && s.trust >= 70 && s.reading && this.clock() - s.lastSeen <= 15000).map(s => ({ ...s.reading, sourceId: s.id, direction: s.direction }));
  }
  async setScenario(name) {
    if (!SCENARIOS[name]) throw new Error('Unknown scenario');
    this.scenario = name; this.securityVersion++;
    await this.setUplink(name !== 'outage');
    await this.record('SCENARIO', { name, synthetic: true });
  }
  async setUplink(connected) {
    if (this.uplink === connected) return;
    this.uplink = connected;
    const buffered = this.pending;
    if (connected) { this.synced += buffered; this.pending = 0; }
    await this.record(connected ? 'DEMO_UPLINK_RESTORED' : 'DEMO_UPLINK_LOST', { buffered, actualCloudService: false });
  }
  async step() {
    this.tick++;
    for (const source of this.sources.values()) {
      const i = DIRECTIONS.indexOf(source.direction), rush = ['congestion', 'conflict'].includes(this.scenario) && i % 2 === 0;
      const pulse = Math.round(2 * Math.sin((this.tick + i) / 4));
      let payload = { count: (rush ? 40 : 17) + pulse, speed: (rush ? 14 : 42) - pulse, queue: (rush ? 25 : 5) + pulse };
      if (this.scenario === 'conflict' && source.id === 'CAM-N') payload.count += 80;
      if (this.scenario === 'fault' && source.id === 'LOOP-E') payload.speed = -12;
      let packet = await sign({ sourceId: source.id, seq: ++source.generatedSeq, timestamp: this.clock() - (this.scenario === 'stale' && source.id === 'CAM-W' ? 120000 : 0), payload }, source.secret);
      if (this.scenario === 'tamper' && source.id === 'CAM-N') packet.payload = { ...packet.payload, count: 180 };
      if (this.scenario === 'replay' && source.id === 'CAM-N' && source.savedPacket) packet = source.savedPacket;
      else if (source.id === 'CAM-N') source.savedPacket = packet;
      await this.ingest(packet);
    }
  }
  async propose(type, sourceId = null) {
    if (!['timing', 'quarantine', 'release'].includes(type)) throw new Error('Unsupported action');
    if (type !== 'timing' && !this.sources.has(sourceId)) throw new Error('Unknown source');
    const twin = simulateTwin(this.trustedReadings(), { seed: this.seed, plan: this.plan });
    if (type === 'timing' && (!twin.available || !twin.recommended)) throw new Error(twin.reason || 'Current timing is already preferable in this simulation.');
    const proposal = { id: crypto.randomUUID(), type, sourceId, plan: type === 'timing' ? twin.candidate : null, evidence: twin, securityVersion: this.securityVersion,
      createdAt: this.clock(), expiresAt: this.clock() + 60000, status: 'pending' };
    this.proposals.unshift(proposal); await this.record('ACTION_PROPOSED', proposal); return structuredClone(proposal);
  }
  async decide(id, decision, actor) {
    if (!actor || actor.role !== 'operator') throw new Error('An authenticated operator is required.');
    const p = this.proposals.find(x => x.id === id);
    if (!p || p.status !== 'pending') throw new Error('Proposal is missing or already decided.');
    if (!['approve', 'reject'].includes(decision)) throw new Error('Invalid decision');
    if (decision === 'approve') {
      if (this.clock() > p.expiresAt) throw new Error('Proposal expired. Simulate and review again.');
      if (p.securityVersion !== this.securityVersion) throw new Error('Security conditions changed. Simulate and review again.');
      if (p.type === 'timing') {
        if (forecast(this.trustedReadings()).unavailable || ![p.plan.ns, p.plan.ew].every(n => Number.isFinite(n) && n >= 15 && n <= 45) || p.plan.ns + p.plan.ew !== 60) throw new Error('Safety gate: fresh trusted data and valid timing bounds are required.');
        // Restart at an all-red clearance. This controls the simulation only.
        this.plan = { ...p.plan }; this.planStarted = this.clock() + 5000;
      } else {
        const source = this.sources.get(p.sourceId); source.quarantined = p.type === 'quarantine'; source.status = source.quarantined ? 'quarantined' : 'waiting';
        if (!source.quarantined) { source.trust = 50; source.reading = null; source.lastSeen = null; }
      }
      this.securityVersion++;
    }
    p.status = decision === 'approve' ? 'approved' : 'rejected'; p.actor = actor.name; p.decidedAt = this.clock();
    await this.record('ACTION_' + p.status.toUpperCase(), { id, type: p.type, sourceId: p.sourceId, plan: p.plan, actor: actor.name, simulatedControllerOnly: true });
    return structuredClone(p);
  }
  state() {
    const sources = [...this.sources.values()].map(({ secret, history, savedPacket, generatedSeq, ...s }) => ({ ...s, fresh: s.lastSeen !== null && this.clock() - s.lastSeen <= 15000, status: s.quarantined ? 'quarantined' : s.lastSeen !== null && this.clock() - s.lastSeen > 15000 ? 'stale' : s.status }));
    const readings = this.trustedReadings(), time = (this.clock() - this.planStarted) / 1000;
    return structuredClone({ version: VERSION, timestamp: this.clock(), tick: this.tick, scenario: this.scenario, sources, alerts: this.alerts, proposals: this.proposals.slice(0, 30), stats: this.stats,
      uplink: this.uplink, pending: this.pending, synced: this.synced, plan: this.plan, signal: time < 0 ? { axis: null, state: 'red', remaining: Math.ceil(-time) } : signalAt(time, this.plan),
      trust: sources.length ? Math.round(sources.reduce((n, s) => n + (s.fresh && !s.quarantined ? s.trust : 0), 0) / sources.length) : 0,
      trustedCount: readings.length, forecast: forecast(readings), twin: simulateTwin(readings, { seed: this.seed, plan: this.plan }), auditHead: this.audit.at(-1)?.hash ?? '0'.repeat(64), auditCount: this.audit.length, auditRecent: this.audit.slice(-20).reverse() });
  }
  export() { return { product: 'FlowTwin CyberShield AI', version: VERSION, exportedAt: this.clock(), provenance: 'Synthetic telemetry; model estimates; no physical controller or live city integration.', state: this.state(), audit: structuredClone(this.audit) }; }
}
export async function createLab(options = {}) {
  const engine = new CyberShield(options);
  for (const d of DIRECTIONS) for (const type of ['loop', 'camera']) await engine.register((type === 'loop' ? 'LOOP-' : 'CAM-') + d, d, type, hex(crypto.getRandomValues(new Uint8Array(32))));
  await engine.record('BOOT', { version: VERSION, input: 'synthetic', seed: engine.seed });
  return engine;
}
