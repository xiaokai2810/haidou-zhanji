import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { clientIp, createApp } from '../server/app.js';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'haidou-duel-test-'));
  const distDir = join(root, 'dist');
  await mkdir(distDir);
  await writeFile(join(distDir, 'index.html'), '<title>海斗联机</title>');
  const dataDir = join(root, 'rooms');
  const app = await createApp({ dataDir, distDir, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return { ...app, base, dataDir, distDir };
}

async function request(base, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) };
}

const post = (base, path, body, token) => request(base, path, { method: 'POST', body, token });
const action = (base, code, token, type, props = {}) => post(base, `/api/rooms/${code}/actions`, { type, ...props }, token);

test('two authorized clients complete four sealed, server-resolved 5v5 rounds and reconnect after restart', async t => {
  const app = await fixture(t);
  const health = await request(app.base, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const catalog = await request(app.base, '/api/catalog');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.champions.length >= 100);
  assert.ok(catalog.body.augments.length >= 100);
  const created = await post(app.base, '/api/rooms', { name: '甲玩家' });
  assert.equal(created.status, 201);
  const code = created.body.code;
  const token0 = created.body.token;
  assert.match(code, /^[A-Z2-9]{7}$/);
  assert.match(token0, /^[0-9a-f]{64}$/);
  assert.equal(created.body.state.status, 'waiting');
  assert.equal(created.body.state.you.heroOffers.length, 2);
  assert.equal(created.body.state.opponent, null);
  assert.equal(JSON.stringify(created.body.state).includes(token0), false);

  const denied = await request(app.base, `/api/rooms/${code}?token=${token0}`);
  assert.equal(denied.status, 401, 'a token in the URL must never authenticate a room');
  const joined = await post(app.base, `/api/rooms/${code}/join`, { name: '乙玩家' });
  assert.equal(joined.status, 200);
  const token1 = joined.body.token;
  assert.notEqual(token0, token1);
  assert.equal(joined.body.state.status, 'playing');
  assert.equal(joined.body.state.phase, 'hero');
  assert.equal(new Set([...created.body.state.you.heroOffers, ...joined.body.state.you.heroOffers].map(hero => hero.id)).size, 4);
  const stored = await readFile(join(app.dataDir, `${code}.json`), 'utf8');
  assert.equal(stored.includes(token0), false, 'only token hashes may be persisted');

  const hero0 = created.body.state.you.heroOffers[0].id;
  const hero1 = joined.body.state.you.heroOffers[0].id;
  const lockedHero = await action(app.base, code, token0, 'choose_hero', { championId: hero0 });
  assert.equal(lockedHero.status, 200);
  assert.equal(lockedHero.body.state.locked[0], true);
  assert.equal(lockedHero.body.state.phase, 'hero');
  const hiddenHero = await request(app.base, `/api/rooms/${code}`, { token: token1 });
  assert.equal(hiddenHero.body.state.opponent.championId, null);
  const duplicateHero = await action(app.base, code, token0, 'choose_hero', { championId: hero0 });
  assert.equal(duplicateHero.status, 409);
  const invalidHero = await action(app.base, code, token1, 'choose_hero', { championId: '__invalid__' });
  assert.equal(invalidHero.status, 400);
  assert.equal((await action(app.base, code, token1, 'choose_hero', { championId: hero1 })).body.state.phase, 'augment');
  let state0 = (await request(app.base, `/api/rooms/${code}`, { token: token0 })).body.state;
  assert.equal(new Set([...state0.teams[0].units, ...state0.teams[1].units].map(unit => unit.championId)).size, 10);

  for (let round = 1; round <= 4; round++) {
    assert.equal(state0.round, round);
    const offersBefore = state0.you.augmentOffers.map(card => card.id);
    if (round === 1) {
      const reroll = await action(app.base, code, token0, 'reroll_augment');
      assert.equal(reroll.status, 200);
      assert.equal(reroll.body.state.you.augmentRerollsRemaining, 0);
      assert.equal(reroll.body.state.you.augmentOffers.filter(card => offersBefore.includes(card.id)).length, 0);
      assert.equal((await action(app.base, code, token0, 'reroll_augment')).status, 400);
      state0 = reroll.body.state;
      assert.equal((await action(app.base, code, token0, 'choose_augment', { augmentId: '__invalid__' })).status, 400);
    }
    const state1 = (await request(app.base, `/api/rooms/${code}`, { token: token1 })).body.state;
    assert.equal((await action(app.base, code, token0, 'choose_augment', { augmentId: state0.you.augmentOffers[0].id })).status, 200);
    const hiddenAugment = (await request(app.base, `/api/rooms/${code}`, { token: token1 })).body.state;
    assert.equal(hiddenAugment.opponent.augmentIds.length, round - 1);
    const secondPick = await action(app.base, code, token1, 'choose_augment', { augmentId: state1.you.augmentOffers[0].id });
    assert.equal(secondPick.body.state.phase, 'shop');

    if (round === 1) {
      assert.equal((await action(app.base, code, token0, 'buy_item', { itemId: '__invalid__' })).status, 400);
      const bought = await action(app.base, code, token0, 'buy_item', { itemId: '3084' });
      assert.equal(bought.status, 200);
      assert.ok(bought.body.state.you.gold < 3500);
    }
    await action(app.base, code, token0, 'ready_shop');
    if (round === 1) {
      const hiddenBuild = (await request(app.base, `/api/rooms/${code}`, { token: token1 })).body.state;
      assert.deepEqual(hiddenBuild.opponent.itemIds, []);
      assert.equal((await action(app.base, code, token0, 'buy_item', { itemId: '1001' })).status, 409);
    }
    const ready = await action(app.base, code, token1, 'ready_shop');
    assert.equal(ready.body.state.phase, 'target');
    const target0 = ready.body.state.you.championId;
    const target1 = ready.body.state.opponent.championId;
    assert.equal((await action(app.base, code, token0, 'choose_target', { championId: '__invalid__' })).status, 400);
    await action(app.base, code, token0, 'choose_target', { championId: target0 });
    const targetReady = await action(app.base, code, token1, 'choose_target', { championId: target1 });
    assert.equal(targetReady.body.state.phase, 'tactic');
    for (const stage of ['engage', 'response', 'finish']) {
      const s0 = (await request(app.base, `/api/rooms/${code}`, { token: token0 })).body.state;
      const s1 = (await request(app.base, `/api/rooms/${code}`, { token: token1 })).body.state;
      assert.equal(s0.tacticStage, stage);
      assert.ok(s0.options.tactics.length >= 8);
      assert.equal((await action(app.base, code, token0, 'choose_tactic', { tacticId: s0.options.tactics[0].id })).status, 200);
      const reply = await action(app.base, code, token1, 'choose_tactic', { tacticId: s1.options.tactics[0].id });
      assert.equal(reply.status, 200);
    }
    const battle = (await request(app.base, `/api/rooms/${code}`, { token: token0 })).body.state;
    assert.equal(battle.phase, 'objective');
    assert.equal(battle.roundReport.round, round);
    assert.equal(battle.roundReport.teams.length, 2);
    assert.equal(battle.roundReport.teams[0].units.length, 5);
    assert.equal(battle.score[0] + battle.score[1], round, 'one battle must resolve exactly once');
    const objective0 = round === 4 ? 'backdoor' : round === 1 ? 'push_tower' : 'farm_wave';
    assert.ok(battle.options.objectives.some(option => option.id === objective0));
    if (round < 4) assert.equal(battle.options.objectives.some(option => option.id === 'backdoor'), false);
    await action(app.base, code, token0, 'choose_objective', { objectiveId: objective0 });
    const hiddenObjective = (await request(app.base, `/api/rooms/${code}`, { token: token1 })).body.state;
    assert.equal(hiddenObjective.roundReport.objectives.length, 0);
    const objectiveReady = await action(app.base, code, token1, 'choose_objective', { objectiveId: 'farm_wave' });
    assert.equal(objectiveReady.body.state.phase, 'report');
    assert.equal(objectiveReady.body.state.roundReport.objectives.length, 2);
    assert.equal(objectiveReady.body.state.score[0] + objectiveReady.body.state.score[1], round);
    assert.ok(objectiveReady.body.state.roundReport.economy[0].total >= 1900);
    const lockedReport = await action(app.base, code, token0, 'ready_report');
    assert.equal(lockedReport.body.state.locked[0], true);
    assert.equal((await action(app.base, code, token0, 'ready_report')).status, 409);
    const continued = await action(app.base, code, token1, 'ready_report');
    assert.equal(continued.status, 200);
    state0 = (await request(app.base, `/api/rooms/${code}`, { token: token0 })).body.state;
  }
  assert.equal(state0.status, 'finished');
  assert.equal(state0.phase, 'finished');
  assert.equal(state0.history.length, 4);
  assert.ok([0, 1].includes(state0.result.winner));
  assert.equal((await action(app.base, code, token0, 'ready_report')).status, 409);
  const revision = state0.revision;
  const restarted = await createApp({ dataDir: app.dataDir, distDir: app.distDir });
  restarted.server.listen(0, '127.0.0.1');
  await once(restarted.server, 'listening');
  const restartBase = `http://127.0.0.1:${restarted.server.address().port}`;
  const restored = await request(restartBase, `/api/rooms/${code}`, { token: token0 });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.state.revision, revision);
  assert.deepEqual(restored.body.state.result, state0.result);
  await new Promise((resolve, reject) => restarted.server.close(error => error ? reject(error) : resolve()));
});

test('concurrent duplicate submissions resolve one transition and never reveal the pending pick', async t => {
  const app = await fixture(t);
  const left = (await post(app.base, '/api/rooms', {})).body;
  const right = (await post(app.base, `/api/rooms/${left.code}/join`, {})).body;
  const hero = left.state.you.heroOffers[0].id;
  const replies = await Promise.all([
    action(app.base, left.code, left.token, 'choose_hero', { championId: hero }),
    action(app.base, left.code, left.token, 'choose_hero', { championId: hero }),
  ]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
  const rightView = (await request(app.base, `/api/rooms/${left.code}`, { token: right.token })).body.state;
  assert.equal(rightView.phase, 'hero');
  assert.equal(rightView.opponent.championId, null);
  assert.equal(rightView.locked[0], true);
});

test('room allocation enforces atomic active-room and per-IP quotas', async t => {
  const limitedIp = await fixture(t, { maxActiveRooms: 10, maxCreatesPerIp: 2 });
  const concurrent = await Promise.all(Array.from({ length: 3 }, () => post(limitedIp.base, '/api/rooms', {})));
  assert.deepEqual(concurrent.map(reply => reply.status).sort(), [201, 201, 429]);
  assert.equal(limitedIp.store.activeCount(), 2);
  const limitedTotal = await fixture(t, { maxActiveRooms: 2, maxCreatesPerIp: 10 });
  assert.equal((await post(limitedTotal.base, '/api/rooms', {})).status, 201);
  assert.equal((await post(limitedTotal.base, '/api/rooms', {})).status, 201);
  assert.equal((await post(limitedTotal.base, '/api/rooms', {})).status, 503);
  const finishedStillCounts = await fixture(t, { maxActiveRooms: 1, maxCreatesPerIp: 10 });
  const first = await post(finishedStillCounts.base, '/api/rooms', {});
  assert.equal(first.status, 201);
  await finishedStillCounts.store.transact(first.body.code, room => ({ ...room, status: 'finished' }));
  assert.equal(finishedStillCounts.store.activeCount(), 0);
  assert.equal((await post(finishedStillCounts.base, '/api/rooms', {})).status, 503, 'finished records still count until expiry');
});

test('proxy address is trusted only when the socket peer is local', () => {
  assert.equal(clientIp({ socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-real-ip': '198.51.100.7' } }), '203.0.113.9');
  assert.equal(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '198.51.100.7' } }), '198.51.100.7');
  assert.equal(clientIp({ socket: { remoteAddress: '::1' }, headers: { 'x-real-ip': 'spoofed' } }), '::1');
});

test('join attempts are throttled and the catalogue uses HTTP cache validators', async t => {
  const app = await fixture(t, { maxJoinsPerIp: 2, maxCatalogPerIp: 2 });
  assert.equal((await post(app.base, '/api/rooms/ABCDEFG/join', {})).status, 404);
  assert.equal((await post(app.base, '/api/rooms/ABCDEFG/join', {})).status, 404);
  assert.equal((await post(app.base, '/api/rooms/ABCDEFG/join', {})).status, 429);
  const first = await fetch(`${app.base}/api/catalog`);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{64}"$/);
  await first.arrayBuffer();
  const cached = await fetch(`${app.base}/api/catalog`, { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304);
  const excess = await request(app.base, '/api/catalog');
  assert.equal(excess.status, 429);
});
