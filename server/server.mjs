import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createLab, CyberShield, verifyAudit } from '../docs/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function createServer({ persist = true, dataDir = path.join(root, '.local'), operatorPassword, clock, autoTick = true } = {}) {
  let engine = await createLab({ clock });
  const sessions = new Map(), attempts = new Map();
  let timer, busy = false, queue = Promise.resolve();
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  if (persist) {
    await mkdir(dataDir, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
      if (!(await verifyAudit(saved.audit)).valid) throw new Error('Persisted audit chain is invalid. Refusing to start.');
      engine = new CyberShield({ clock });
      Object.assign(engine, saved); engine.sources = new Map(saved.sources);
      await engine.record('RESTART', { auditVerified: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!operatorPassword) {
      try { operatorPassword = (await readFile(path.join(dataDir, 'operator-password.txt'), 'utf8')).trim(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; operatorPassword = randomBytes(24).toString('base64url'); await writeFile(path.join(dataDir, 'operator-password.txt'), operatorPassword + '\n', { mode: 0o600 }); }
    }
  }
  operatorPassword ||= randomBytes(24).toString('base64url');
  const salt = randomBytes(16), passwordHash = scryptSync(operatorPassword, salt, 32);
  async function save() {
    if (!persist) return;
    const snapshot = { ...engine, sources: [...engine.sources], clock: undefined };
    await writeFile(path.join(dataDir, 'state.tmp'), JSON.stringify(snapshot), { mode: 0o600 });
    await rename(path.join(dataDir, 'state.tmp'), path.join(dataDir, 'state.json'));
  }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
    const host = req.headers.host;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host || '')) { res.writeHead(403).end('Localhost only'); return; }
    const url = new URL(req.url, 'http://' + host);
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    async function body() {
      let text = '';
      for await (const chunk of req) { text += chunk; if (text.length > 65536) { const e = new Error('Request exceeds 64 KB'); e.status = 413; throw e; } }
      try { return JSON.parse(text || '{}'); } catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
    }
    const sessionId = /(?:^|;\s*)cs_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const session = sessions.get(sessionId);
    const actor = session && session.expires > Date.now() ? { name: 'Local operator', role: 'operator' } : null;
    try {
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && origin !== 'http://' + host) return json(403, { error: 'Cross-origin mutation denied.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON content type required.' });
      }
      if (url.pathname === '/api/state' && req.method === 'GET') return json(200, { mode: 'server', authenticated: !!actor, ...engine.state() });
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const key = req.socket.remoteAddress, recent = attempts.get(key) || { count: 0, since: Date.now() };
        if (Date.now() - recent.since > 60000) { recent.count = 0; recent.since = Date.now(); }
        if (recent.count >= 5) return json(429, { error: 'Too many attempts. Retry after one minute.' });
        const input = await body();
        if (typeof input.password !== 'string' || !timingSafeEqual(scryptSync(input.password, salt, 32), passwordHash)) {
          recent.count++; attempts.set(key, recent); return json(401, { error: 'Invalid operator password.' });
        }
        attempts.delete(key);
        const id = randomBytes(32).toString('base64url'); sessions.set(id, { expires: Date.now() + 3600000 });
        res.setHeader('Set-Cookie', `cs_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
        await serial(() => engine.record('OPERATOR_LOGIN', { name: 'Local operator' })); return json(200, { authenticated: true });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') { sessions.delete(sessionId); res.setHeader('Set-Cookie', 'cs_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(200, { authenticated: false }); }
      if (url.pathname === '/api/ingest' && req.method === 'POST') {
        const packet = await body(); const result = await serial(async () => { const result = await engine.ingest(packet); await save(); return result; });
        return json(result.accepted ? 202 : 422, result);
      }
      if (url.pathname === '/api/export' && req.method === 'GET') return json(200, await serial(() => engine.export()));
      if (url.pathname === '/api/verify' && req.method === 'GET') return json(200, await serial(() => verifyAudit(engine.audit)));
      if (url.pathname.startsWith('/api/') && req.method === 'POST') {
        if (!actor) return json(401, { error: 'Sign in as an operator to change the simulation.' });
        const input = await body();
        const result = await serial(async () => {
          let result;
          if (url.pathname === '/api/scenario') { await engine.setScenario(input.name); await engine.step(); result = { ok: true }; }
          else if (url.pathname === '/api/propose') result = await engine.propose(input.type, input.sourceId);
          else if (url.pathname === '/api/decide') result = await engine.decide(input.id, input.decision, actor);
          else { const e = new Error('Unknown API route'); e.status = 404; throw e; }
          await save(); return result;
        });
        return json(200, result);
      }
      if (url.pathname.startsWith('/api/')) return json(404, { error: 'Unknown API route' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Method not allowed' });
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filename = path.resolve(root, 'docs', '.' + relative), directory = path.join(root, 'docs') + path.sep;
      if (!filename.startsWith(directory)) return json(403, { error: 'Forbidden path' });
      const bytes = await readFile(filename);
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Service-Worker-Allowed': '/' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) { json(error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? 'Not found' : error.message }); }
  });
  await engine.step(); await save();
  if (autoTick) timer = setInterval(() => {
    if (busy) return; busy = true;
    serial(async () => { await engine.step(); await save(); }).catch(error => console.error('Telemetry step failed:', error.message)).finally(() => { busy = false; });
  }, 2000);
  server.on('close', () => clearInterval(timer));
  return { server, engine, close: async () => { clearInterval(timer); await queue; await save(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4186);
  const app = await createServer({ operatorPassword: process.env.CYBERSHIELD_OPERATOR_PASSWORD });
  app.server.listen(port, '127.0.0.1', () => console.log(`CyberShield running at http://127.0.0.1:${port}\nOperator password: .local/operator-password.txt (or your configured environment password)`));
  const stop = async () => { await app.close(); process.exit(0); }; process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
