import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomStore } from './store.js';
import { actDuel, createDuel, joinDuel, viewDuel } from '../src/duel-engine.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const CODE_PATTERN = /^[A-Z2-9]{7}$/;
const CREATE_WINDOW_MS = 10 * 60 * 1000;

function json(response, status, data, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  response.end(JSON.stringify(data));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw httpError(413, '请求内容过大');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('object required');
    return body;
  } catch { throw httpError(400, '请求 JSON 无效'); }
}

function safeName(value, fallback) {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) : '';
  return name || fallback;
}

function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }

function authSeat(room, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw httpError(401, '缺少或无效的重连凭证');
  const actual = Buffer.from(tokenHash(token), 'hex');
  for (const player of room.players) {
    if (!player?.tokenHash || !/^[0-9a-f]{64}$/.test(player.tokenHash)) continue;
    if (timingSafeEqual(actual, Buffer.from(player.tokenHash, 'hex'))) return player.seat;
  }
  throw httpError(401, '重连凭证不属于此房间');
}

function bearer(request) {
  const header = request.headers.authorization;
  const match = typeof header === 'string' && /^Bearer ([0-9a-f]{64})$/i.exec(header);
  return match ? match[1] : null;
}

export function clientIp(request) {
  const peer = request.socket?.remoteAddress || '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const forwarded = request.headers?.['x-real-ip'];
  // Nginx overwrites X-Real-IP. Never trust user-supplied forwarding headers
  // from a remote connection directly to Node.
  if (loopback && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return peer;
}

async function staticFile(response, pathname, distDir) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try { decoded = decodeURIComponent(normalized); }
  catch { throw httpError(400, '路径编码无效'); }
  if (decoded.includes('\0')) throw httpError(400, '路径无效');
  const target = resolve(distDir, `.${decoded}`);
  if (target !== distDir && !target.startsWith(distDir + sep)) throw httpError(403, '路径不可访问');
  let info;
  try { info = await stat(target); }
  catch { throw httpError(404, '资源不存在'); }
  if (!info.isFile()) throw httpError(404, '资源不存在');
  const data = await readFile(target);
  const extension = extname(target).toLowerCase();
  response.writeHead(200, {
    'Content-Type': FILE_TYPES[extension] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(data);
}

export async function createApp({
  dataDir = process.env.ROOM_DATA_DIR || join(PROJECT_ROOT, 'data', 'rooms'),
  distDir = join(PROJECT_ROOT, 'dist'),
  catalogDir = join(PROJECT_ROOT, 'public', 'data'),
  now = () => Date.now(),
  maxActiveRooms = Number(process.env.MAX_ACTIVE_ROOMS || 200),
  maxCreatesPerIp = Number(process.env.MAX_CREATES_PER_IP || 5),
  maxJoinsPerIp = Number(process.env.MAX_JOINS_PER_IP || 30),
  maxCatalogPerIp = Number(process.env.MAX_CATALOG_PER_IP || 120),
} = {}) {
  const db = {};
  for (const name of ['champions', 'augments', 'items', 'meta']) db[name] = JSON.parse(await readFile(join(catalogDir, `${name}.json`), 'utf8'));
  const store = new RoomStore(dataDir, now);
  await store.init();
  if (![maxActiveRooms, maxCreatesPerIp, maxJoinsPerIp, maxCatalogPerIp].every(value => Number.isInteger(value) && value > 0)) throw new Error('房间配额必须是正整数');
  const createTimes = new Map();
  const joinTimes = new Map();
  const catalogTimes = new Map();
  const catalogBody = JSON.stringify(db);
  const catalogEtag = `"${createHash('sha256').update(catalogBody).digest('hex')}"`;
  const recentTimes = (map, ip) => (map.get(ip) || []).filter(time => now() - time < CREATE_WINDOW_MS);
  const noteAccess = (map, ip) => {
    const times = recentTimes(map, ip);
    times.push(now());
    map.set(ip, times);
    if (map.size > 50000) map.delete(map.keys().next().value);
    return times.length;
  };
  const checkCreateQuota = ip => {
    const recent = recentTimes(createTimes, ip);
    if (recent.length >= maxCreatesPerIp) throw httpError(429, '创建房间过于频繁，请稍后再试');
    // Completed rooms also consume disk and memory until their expiry.
    if (store.rooms.size >= maxActiveRooms) throw httpError(503, '当前房间已满，请稍后再试');
    createTimes.set(ip, recent);
  };
  const noteCreate = ip => noteAccess(createTimes, ip);
  const cleanupTimer = setInterval(() => store.cleanup().catch(() => {}), 15 * 60 * 1000);
  cleanupTimer.unref();
  const quotaTimer = setInterval(() => {
    for (const map of [createTimes, joinTimes, catalogTimes]) {
      for (const [ip, times] of map) {
        const recent = times.filter(time => now() - time < CREATE_WINDOW_MS);
        if (recent.length) map.set(ip, recent);
        else map.delete(ip);
      }
    }
  }, 10 * 60 * 1000);
  quotaTimer.unref();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      const path = url.pathname;
      if (path === '/api/health') {
        if (request.method !== 'GET') throw httpError(405, '仅支持 GET');
        return json(response, 200, { ok: true, rooms: store.rooms.size });
      }
      if (path === '/api/catalog') {
        if (request.method !== 'GET') throw httpError(405, '仅支持 GET');
        if (noteAccess(catalogTimes, clientIp(request)) > maxCatalogPerIp) throw httpError(429, '目录请求过于频繁，请稍后再试');
        const headers = {
          'Cache-Control': 'public, max-age=3600', ETag: catalogEtag,
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        };
        if (request.headers['if-none-match'] === catalogEtag) {
          response.writeHead(304, headers); response.end(); return;
        }
        response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(catalogBody) });
        response.end(catalogBody); return;
      }
      if (path === '/api/rooms' && request.method === 'POST') {
        const body = await bodyJson(request);
        const ip = clientIp(request);
        const token = randomBytes(32).toString('hex');
        const room = await store.create(code => createDuel({
          code, name: safeName(body.name, '玩家一'), tokenHash: tokenHash(token),
          seed: randomBytes(4).readUInt32LE(0), db, now: now(),
        }), () => checkCreateQuota(ip), () => noteCreate(ip));
        return json(response, 201, { code: room.code, token, seat: 0, revision: room.revision, state: viewDuel(room, 0, db) });
      }
      const match = /^\/api\/rooms\/([^/]+)(?:\/(join|actions))?$/.exec(path);
      if (match) {
        const code = match[1].toUpperCase();
        if (!CODE_PATTERN.test(code)) throw httpError(404, '房间不存在');
        const operation = match[2];
        if (operation === 'join' && request.method === 'POST' && noteAccess(joinTimes, clientIp(request)) > maxJoinsPerIp) throw httpError(429, '加入房间尝试过于频繁，请稍后再试');
        const room = store.get(code);
        if (!room) throw httpError(404, '房间不存在或已过期');
        if (operation === 'join') {
          if (request.method !== 'POST') throw httpError(405, '仅支持 POST');
          const body = await bodyJson(request);
          const token = randomBytes(32).toString('hex');
          const joined = await store.transact(code, current => joinDuel(current, {
            name: safeName(body.name, '玩家二'), tokenHash: tokenHash(token), db, now: now(),
          }));
          if (!joined) throw httpError(404, '房间不存在或已过期');
          return json(response, 200, { code, token, seat: 1, revision: joined.revision, state: viewDuel(joined, 1, db) });
        }
        if (operation === 'actions') {
          if (request.method !== 'POST') throw httpError(405, '仅支持 POST');
          const body = await bodyJson(request);
          const token = bearer(request) || body.token;
          const seat = authSeat(room, token);
          const updated = await store.transact(code, current => {
            authSeat(current, token);
            return actDuel(current, seat, body, db, now());
          });
          if (!updated) throw httpError(404, '房间不存在或已过期');
          return json(response, 200, { code, seat, revision: updated.revision, state: viewDuel(updated, seat, db) });
        }
        if (request.method !== 'GET') throw httpError(405, '仅支持 GET');
        const seat = authSeat(room, bearer(request));
        return json(response, 200, { code, seat, revision: room.revision, state: viewDuel(room, seat, db) });
      }
      if (path.startsWith('/api/')) throw httpError(404, '接口不存在');
      if (request.method !== 'GET' && request.method !== 'HEAD') throw httpError(405, '仅支持 GET');
      await staticFile(response, path, resolve(distDir));
    } catch (error) {
      const status = error.status || (/(当前阶段|已锁定|房间已满)/.test(error.message) ? 409 : error.message && !error.code ? 400 : 500);
      if (status >= 500 && !error.status) process.stderr.write(`server error: ${error.message}\n`);
      if (!response.headersSent) json(response, status, { error: status >= 500 ? '服务器暂时不可用' : error.message });
      else response.end();
    }
  });
  server.on('close', () => { clearInterval(cleanupTimer); clearInterval(quotaTimer); });
  return { server, store, db };
}
