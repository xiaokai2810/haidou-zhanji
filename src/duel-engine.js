import { clamp, computeBuild } from './model.js';
import { damageProfile } from './battle-engine.js';
import { TACTIC_OPTIONS, OBJECTIVE_OPTIONS, getSynergies } from './standalone-engine.js';

// Only the server imports this module. The room RNG is stored with the match,
// so reconnects and process restarts cannot change an already drawn outcome.
const LEVELS = [1, 7, 11, 15];
const RARITIES = ['silver', 'gold', 'prismatic'];
const STAGES = ['engage', 'response', 'finish'];
const BOT_ROLES = ['Tank', 'Fighter', 'Mage', 'Marksman'];
const BOT_ITEMS = {
  Tank: ['3084', '3065', '3075', '3143'],
  Fighter: ['3078', '3053', '3074', '6333'],
  Mage: ['6653', '3089', '3135', '3157'],
  Marksman: ['3046', '3031', '3153', '3036'],
  Assassin: ['3142', '6676', '6696', '3036'],
  Support: ['6617', '2065', '3107', '3504'],
};
const BOT_AUGMENTS = {
  Tank: ['goliath', 'celestial_body', 'deft', 'recursion'],
  Fighter: ['blunt_force', 'goliath', 'deft', 'recursion'],
  Mage: ['witchful_thinking', 'recursion', 'goliath', 'deft'],
  Marksman: ['deft', 'blunt_force', 'goliath', 'recursion'],
  Assassin: ['blunt_force', 'deft', 'recursion', 'goliath'],
  Support: ['recursion', 'goliath', 'witchful_thinking', 'deft'],
};
const IMMEDIATE_AUGMENT_GOLD = {
  donation: 1750, upgrade_infinity_edge: 500, upgrade_collector: 250,
  upgrade_immolate: 250, upgrade_sheen: 250,
};
const clone = value => JSON.parse(JSON.stringify(value));
const byId = (rows, id) => rows.find(row => row.id === id);
const other = seat => 1 - seat;
const roleOf = champion => champion.tags.find(tag => BOT_ITEMS[tag]) || 'Fighter';

function random(room) {
  let x = room.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  room.rng = x >>> 0;
  return room.rng / 0x100000000;
}

function draw(room, pool) {
  if (!pool.length) throw new Error('候选池不足，无法继续匹配');
  return pool.splice(Math.floor(random(room) * pool.length), 1)[0];
}

function drawHeroOffers(room, seat, db) {
  const used = new Set(room.players.flatMap(player => player?.heroOffers || []));
  const pool = db.champions.filter(champion => !used.has(champion.id));
  room.players[seat].heroOffers = [draw(room, pool).id, draw(room, pool).id];
}

function drawAugments(room, seat, db) {
  const player = room.players[seat];
  const seen = new Set([...player.seenAugmentIds, ...player.augmentIds]);
  const pool = db.augments.filter(card => card.rarity === room.offerRarity && !seen.has(card.id));
  if (pool.length < 3) throw new Error('当前稀有度的海克斯候选不足');
  player.augmentOffers = Array.from({ length: 3 }, () => draw(room, pool).id);
  player.seenAugmentIds.push(...player.augmentOffers);
  player.augmentRerollsRemaining = 1;
}

function clearLock(room) { room.locked = [false, false]; }
function bothLocked(room) { return room.locked[0] && room.locked[1]; }
function lock(room, seat) { room.locked[seat] = true; }
function requirePhase(room, phase, seat) {
  if (room.status !== 'playing' || room.phase !== phase) throw new Error('当前阶段不能执行该操作');
  if (room.locked[seat]) throw new Error('你已锁定本阶段选择，请等待对手');
}

function playerFactory(seat, name, tokenHash) {
  return {
    seat, name, tokenHash, heroOffers: [], championId: null,
    augmentOffers: [], augmentRerollsRemaining: 0, seenAugmentIds: [],
    augmentIds: [], itemIds: [], gold: 3500, level: 1, growth: {},
    allies: [], targetId: null, tactics: {}, objectiveId: null,
    pendingHeroId: null, pendingAugmentId: null, pendingTargetId: null,
    pendingTacticId: null, pendingObjectiveId: null, publishedBuild: null,
    kills: 0, deaths: 0, assists: 0, damage: 0,
  };
}

export function createDuel({ code, name, tokenHash, seed, db, now = Date.now() }) {
  if (!db?.champions?.length || !db?.augments?.length || !db?.items?.length) throw new Error('缺少游戏目录');
  const room = {
    version: 1, code, rng: (seed >>> 0) || 0x6d2b79f5, createdAt: now, updatedAt: now,
    status: 'waiting', phase: 'hero', round: 1, maxRounds: 4, revision: 1,
    players: [playerFactory(0, name, tokenHash), null], locked: [false, false],
    offerRarity: null, tacticStage: null,
    score: { 0: 0, 1: 0 }, towers: { 0: 100, 1: 100 },
    control: { 0: 0, 1: 0 }, winStreak: { 0: 0, 1: 0 },
    roundReport: null, history: [], result: null,
  };
  drawHeroOffers(room, 0, db);
  return room;
}

export function joinDuel(room, { name, tokenHash, db, now = Date.now() }) {
  if (room.status !== 'waiting' || room.players[1]) throw new Error('房间已满或对局已开始');
  const next = clone(room);
  next.players[1] = playerFactory(1, name, tokenHash);
  drawHeroOffers(next, 1, db);
  next.status = 'playing';
  next.updatedAt = now;
  next.revision++;
  return next;
}

function assignAllies(room, db) {
  const used = new Set(room.players.map(player => player.championId));
  for (const player of room.players) {
    player.allies = BOT_ROLES.map(role => {
      let pool = db.champions.filter(champion => !used.has(champion.id) && champion.tags[0] === role);
      if (!pool.length) pool = db.champions.filter(champion => !used.has(champion.id) && champion.tags.includes(role));
      if (!pool.length) pool = db.champions.filter(champion => !used.has(champion.id));
      const champion = draw(room, pool);
      used.add(champion.id);
      return champion.id;
    });
  }
}

function prepareAugments(room, db) {
  room.offerRarity = RARITIES[Math.floor(random(room) * RARITIES.length)];
  for (const player of room.players) drawAugments(room, player.seat, db);
  room.phase = 'augment';
  clearLock(room);
}

function addSelectedAugments(room) {
  for (const player of room.players) {
    player.augmentIds.push(player.pendingAugmentId);
    player.gold += IMMEDIATE_AUGMENT_GOLD[player.pendingAugmentId] || 0;
    player.pendingAugmentId = null;
    player.augmentOffers = [];
    // Both selections are now committed, so the chosen cards are public even
    // while later shop changes remain private until both players ready up.
    player.publishedBuild ||= { itemIds: [], gold: 3500, augmentIds: [] };
    player.publishedBuild.augmentIds = [...player.augmentIds];
  }
  room.phase = 'shop';
  clearLock(room);
}

function buyItem(player, id, db) {
  const item = byId(db.items, id);
  if (!item || item.purchasable === false || !['component', 'starter', 'legendary', 'boots'].includes(item.category) || !((item.shopCost ?? item.gold) > 0)) throw new Error('只能购买目录中的可购装备');
  if (['legendary', 'boots'].includes(item.category) && player.itemIds.includes(id)) throw new Error('每种成装只能购买一件');
  const inventory = [...player.itemIds];
  let discount = 0;
  for (const componentId of item.from || []) {
    const index = inventory.indexOf(componentId);
    if (index >= 0) {
      inventory.splice(index, 1);
      const component = byId(db.items, componentId);
      discount += component?.shopCost ?? component?.gold ?? 0;
    }
  }
  if (inventory.length >= 6) throw new Error('装备栏已满');
  if (item.category === 'boots' && inventory.some(owned => byId(db.items, owned)?.category === 'boots')) throw new Error('最多只能持有一双鞋子');
  const cost = Math.max(0, (item.shopCost ?? item.gold) - discount);
  if (player.gold < cost) throw new Error('金币不足');
  player.gold -= cost;
  player.itemIds = [...inventory, id];
  return cost;
}

function sellItem(player, id, db) {
  const index = player.itemIds.indexOf(id);
  const item = byId(db.items, id);
  if (index < 0 || !item) throw new Error('未持有这件装备');
  player.itemIds.splice(index, 1);
  const refund = Math.floor((item.shopCost ?? item.gold) * .7);
  player.gold += refund;
  delete player.growth[id];
  delete player.growth[`evolve:${id}`];
  return refund;
}

function publishBuilds(room) {
  for (const player of room.players) player.publishedBuild = {
    itemIds: [...player.itemIds], gold: player.gold, augmentIds: [...player.augmentIds],
  };
}

function advanceAfterReport(room, db) {
  if (room.result || room.round >= room.maxRounds) {
    room.status = 'finished'; room.phase = 'finished'; clearLock(room); return;
  }
  room.round++;
  for (const player of room.players) {
    player.level = LEVELS[room.round - 1];
    player.targetId = null;
    player.tactics = {};
    player.objectiveId = null;
  }
  room.roundReport = null;
  room.tacticStage = null;
  prepareAugments(room, db);
}

export function actDuel(room, seat, action, db, now = Date.now()) {
  if (!room.players[seat]) throw new Error('无效席位');
  if (!action || typeof action !== 'object') throw new Error('缺少操作');
  const next = clone(room);
  const player = next.players[seat];
  switch (action.type) {
    case 'choose_hero': {
      requirePhase(next, 'hero', seat);
      if (!player.heroOffers.includes(action.championId)) throw new Error('只能选择当前随机提供的英雄');
      player.pendingHeroId = action.championId;
      lock(next, seat);
      if (bothLocked(next)) {
        for (const participant of next.players) {
          participant.championId = participant.pendingHeroId;
          participant.pendingHeroId = null;
        }
        assignAllies(next, db);
        prepareAugments(next, db);
      }
      break;
    }
    case 'reroll_augment': {
      requirePhase(next, 'augment', seat);
      if (player.augmentRerollsRemaining < 1) throw new Error('本轮刷新机会已用完');
      const seen = new Set([...player.seenAugmentIds, ...player.augmentIds]);
      const pool = db.augments.filter(card => card.rarity === next.offerRarity && !seen.has(card.id));
      if (pool.length < 3) throw new Error('剩余海克斯候选不足');
      player.augmentOffers = Array.from({ length: 3 }, () => draw(next, pool).id);
      player.seenAugmentIds.push(...player.augmentOffers);
      player.augmentRerollsRemaining = 0;
      break;
    }
    case 'choose_augment': {
      requirePhase(next, 'augment', seat);
      if (!player.augmentOffers.includes(action.augmentId)) throw new Error('只能选择当前三张海克斯之一');
      player.pendingAugmentId = action.augmentId;
      lock(next, seat);
      if (bothLocked(next)) addSelectedAugments(next);
      break;
    }
    case 'buy_item': {
      requirePhase(next, 'shop', seat);
      buyItem(player, action.itemId, db);
      break;
    }
    case 'sell_item': {
      requirePhase(next, 'shop', seat);
      sellItem(player, action.itemId, db);
      break;
    }
    case 'ready_shop': {
      requirePhase(next, 'shop', seat);
      lock(next, seat);
      if (bothLocked(next)) {
        publishBuilds(next);
        next.phase = 'target';
        clearLock(next);
      }
      break;
    }
    case 'choose_target': {
      requirePhase(next, 'target', seat);
      const enemy = next.players[other(seat)];
      if (![enemy.championId, ...enemy.allies].includes(action.championId)) throw new Error('只能标记敌方五名英雄之一');
      player.pendingTargetId = action.championId;
      lock(next, seat);
      if (bothLocked(next)) {
        for (const participant of next.players) {
          participant.targetId = participant.pendingTargetId;
          participant.pendingTargetId = null;
        }
        next.phase = 'tactic'; next.tacticStage = 'engage'; clearLock(next);
      }
      break;
    }
    case 'choose_tactic': {
      requirePhase(next, 'tactic', seat);
      if (!TACTIC_OPTIONS[next.tacticStage]?.some(option => option.id === action.tacticId)) throw new Error('请选择当前阶段提供的战术');
      player.pendingTacticId = action.tacticId;
      lock(next, seat);
      if (bothLocked(next)) {
        for (const participant of next.players) {
          participant.tactics[next.tacticStage] = participant.pendingTacticId;
          participant.pendingTacticId = null;
        }
        const stageIndex = STAGES.indexOf(next.tacticStage);
        if (stageIndex === STAGES.length - 1) {
          next.roundReport = resolveFight(next, db);
          next.phase = 'objective'; next.tacticStage = null;
        } else next.tacticStage = STAGES[stageIndex + 1];
        clearLock(next);
      }
      break;
    }
    case 'choose_objective': {
      requirePhase(next, 'objective', seat);
      if (!getDuelObjectiveOptions(next).some(option => option.id === action.objectiveId)) throw new Error('请选择当前可用的战后行动');
      player.pendingObjectiveId = action.objectiveId;
      lock(next, seat);
      if (bothLocked(next)) {
        for (const participant of next.players) {
          participant.objectiveId = participant.pendingObjectiveId;
          participant.pendingObjectiveId = null;
        }
        resolveObjectives(next, db);
        next.phase = 'report'; clearLock(next);
      }
      break;
    }
    case 'ready_report': {
      requirePhase(next, 'report', seat);
      lock(next, seat);
      if (bothLocked(next)) advanceAfterReport(next, db);
      break;
    }
    default: throw new Error('未知操作');
  }
  next.updatedAt = now;
  next.revision++;
  return next;
}

export function getDuelObjectiveOptions(room) {
  return OBJECTIVE_OPTIONS.filter(option => option.id !== 'backdoor' || room.round === room.maxRounds);
}

function combatant(championId, seat, isHuman, player, room, db) {
  const champion = byId(db.champions, championId);
  const role = roleOf(champion);
  const itemIds = isHuman ? player.itemIds : (BOT_ITEMS[role] || BOT_ITEMS.Fighter).slice(0, room.round);
  const augmentIds = isHuman ? player.augmentIds : (BOT_AUGMENTS[role] || BOT_AUGMENTS.Fighter).slice(0, room.round);
  const panel = computeBuild({
    champion, level: player.level,
    items: itemIds.map(id => byId(db.items, id)).filter(Boolean),
    augments: augmentIds.map(id => byId(db.augments, id)).filter(Boolean),
    growth: isHuman ? player.growth : {}, targetArmor: 0, targetMr: 0,
  });
  return {
    seat, isHuman, champion, panel, itemIds, augmentIds,
    hp: panel.stats.hp, maxHp: panel.stats.hp, damage: 0, kills: 0,
  };
}

function isBackline(champion) {
  return champion.tags.some(tag => ['Mage', 'Marksman', 'Support'].includes(tag));
}

function isFrontline(champion) {
  return champion.tags.some(tag => ['Tank', 'Fighter'].includes(tag));
}

function tacticEffects(player, enemy, room, db) {
  const hero = byId(db.champions, player.championId);
  const ranged = hero.stats.attackrange >= 400;
  const synergies = getSynergies({ player }, db);
  const modeled = new Set(['draw_your_sword', 'blunt_force', 'witchful_thinking', 'goliath', 'celestial_body', 'deft', 'recursion', 'infinite_recursion', 'phenomenal_evil']);
  let proxyAttack = 0, proxyDefense = 0;
  for (const id of player.augmentIds) {
    if (modeled.has(id)) continue;
    const card = byId(db.augments, id);
    if (!card) continue;
    const amount = card.rarity === 'prismatic' ? .035 : card.rarity === 'gold' ? .025 : .015;
    if (/护盾|治疗|生命|护甲|魔抗/.test(`${card.name} ${card.effect || ''}`)) proxyDefense += amount;
    else proxyAttack += amount;
  }
  const effect = {
    attack: 1 + clamp(proxyAttack, 0, .12) + clamp(synergies.reduce((sum, rule) => sum + rule.attack, 0), 0, .25),
    defense: 1 + clamp(proxyDefense, 0, .12) + clamp(synergies.reduce((sum, rule) => sum + rule.defense, 0), 0, .20),
    teamAttack: 1 + (room.control[player.seat] - room.control[enemy.seat]) * .022,
    teamDefense: 1 + (room.control[player.seat] - room.control[enemy.seat]) * .018,
    focusDamage: 1, extraRisk: 1, openingAttack: 1, backline: 1,
    frontline: 1, steel: 1 + clamp(synergies.reduce((sum, rule) => sum + rule.steel, 0), 0, .7),
    siege: 1, sustain: 0,
  };
  switch (player.tactics.engage) {
    case 'backline': effect.backline *= 1.18; effect.extraRisk *= 1.10; break;
    case 'frontline': effect.frontline *= 1.12; effect.defense *= 1.04; break;
    case 'flank': effect.backline *= 1.11; effect.teamAttack *= 1.05; effect.teamDefense *= .94; break;
    case 'guard': effect.teamDefense *= 1.08; effect.attack *= .96; break;
    case 'steel': effect.frontline *= 1.03; effect.steel *= 1.38; effect.attack *= .96; break;
    case 'ambush': effect.openingAttack *= 1.27; effect.extraRisk *= 1.09; break;
    case 'poke': effect.openingAttack *= ranged ? 1.22 : .88; break;
    case 'press': effect.teamAttack *= 1.08; effect.teamDefense *= .94; break;
  }
  switch (player.tactics.response) {
    case 'burst': effect.attack *= 1.15; effect.extraRisk *= 1.07; break;
    case 'kite': effect.attack *= ranged ? 1.03 : .91; effect.defense *= 1.10; break;
    case 'peel': effect.attack *= .94; effect.teamDefense *= 1.07; break;
    case 'sustain': effect.attack *= .97; effect.sustain += .07; effect.defense *= 1.04; break;
    case 'steel': effect.attack *= .98; effect.steel *= 1.34; effect.extraRisk *= 1.04; break;
    case 'interrupt': effect.teamDefense *= enemy.allies.some(id => byId(db.champions, id)?.tags.some(tag => ['Assassin', 'Mage'].includes(tag))) ? 1.08 : 1.025; effect.attack *= .97; break;
    case 'all_in': effect.attack *= 1.20; effect.extraRisk *= 1.16; break;
    case 'bait': effect.teamAttack *= 1.07; effect.teamDefense *= .96; break;
  }
  switch (player.tactics.finish) {
    case 'chase': effect.attack *= 1.12; effect.extraRisk *= 1.10; break;
    case 'secure': effect.attack *= .98; effect.teamAttack *= 1.08; break;
    case 'disengage': effect.attack *= .85; effect.teamAttack *= .88; effect.teamDefense *= 1.04; effect.defense *= 1.07; break;
    case 'counter': effect.attack *= 1.06; effect.teamDefense *= 1.02; break;
    case 'steel': effect.attack *= .94; effect.steel *= 1.30; break;
    case 'execute': effect.focusDamage *= 1.18; effect.teamDefense *= .94; break;
    case 'escort': effect.attack *= .84; effect.teamAttack *= .88; effect.teamDefense *= 1.09; break;
    case 'siege_ready': effect.attack *= .92; effect.siege *= 1.30; break;
  }
  return effect;
}

function pickTarget(room, attacker, defenders, side, effect) {
  const focusId = room.players[side].targetId;
  let chosen = null, best = -Infinity;
  for (let index = 0; index < defenders.length; index++) {
    const target = defenders[index];
    if (target.hp <= 0) continue;
    let score = (1 - target.hp / target.maxHp) * 2;
    if (isFrontline(target.champion)) score += .55;
    if (attacker.champion.tags.includes('Assassin') && isBackline(target.champion)) score += 1.2;
    if (target.champion.id === focusId) score += attacker.isHuman ? 3.4 : 1.55;
    if (attacker.isHuman && isBackline(target.champion) && effect.backline > 1) score += 1.5;
    if (attacker.isHuman && isFrontline(target.champion) && effect.frontline > 1) score += 1.5;
    score += random(room) * .2;
    if (score > best) { chosen = index; best = score; }
  }
  return chosen;
}

function growthAfterFight(player, combatant, steelHits, report, db) {
  const events = [];
  if (player.itemIds.includes('3084') && steelHits > 0) {
    const added = steelHits * 30 * (player.augmentIds.includes('quest_steel_your_heart') ? 3 : 1);
    player.growth['3084'] = (player.growth['3084'] || 0) + added;
    events.push(`心之钢永久生命值 +${added}`);
  }
  if (player.augmentIds.includes('phenomenal_evil')) {
    const added = clamp(Math.round(combatant.damage / 450), 2, 12);
    player.growth.phenomenal_evil = (player.growth.phenomenal_evil || 0) + added;
    events.push(`超凡邪恶 +${added} 层`);
  }
  if (player.augmentIds.includes('infinite_recursion')) {
    const added = Math.min(5, report.teams[player.seat].kills);
    player.growth.infinite_recursion = (player.growth.infinite_recursion || 0) + added;
    events.push(`无限循环往复 +${added} 次参与击杀`);
  }
  if (player.itemIds.includes('126697') && combatant.kills) {
    const added = combatant.kills * 2;
    player.growth['126697'] = (player.growth['126697'] || 0) + added;
    events.push(`狂妄攻击力 +${added}`);
  }
  if (player.itemIds.includes('6657')) {
    player.growth['6657'] = Math.min(10, (player.growth['6657'] || 0) + 3);
    events.push(`时光之杖 ${player.growth['6657']} 层`);
  }
  for (const evolved of db.items.filter(item => item.category === 'evolved' && item.evolvesFrom)) {
    const index = player.itemIds.indexOf(evolved.evolvesFrom);
    if (index < 0) continue;
    const key = `evolve:${evolved.evolvesFrom}`;
    const progress = (player.growth[key] || 0) + 1;
    if (progress >= 2) {
      player.itemIds[index] = evolved.id;
      delete player.growth[key];
      events.push(`${byId(db.items, evolved.evolvesFrom)?.name || '装备'}进化为${evolved.name}`);
    } else player.growth[key] = progress;
  }
  return events;
}

function resolveFight(room, db) {
  const teams = room.players.map(player => [player.championId, ...player.allies]
    .map((id, index) => combatant(id, player.seat, index === 0, player, room, db)));
  const effects = room.players.map((player, seat) => tacticEffects(player, room.players[other(seat)], room, db));
  const steelHits = [0, 0];
  const events = [];
  let ticks = 0;
  for (; ticks < 72; ticks++) {
    if (!teams[0].some(unit => unit.hp > 0) || !teams[1].some(unit => unit.hp > 0)) break;
    const incoming = [Array(5).fill(0), Array(5).fill(0)];
    const killers = [Array(5).fill(null), Array(5).fill(null)];
    for (const seat of [0, 1]) {
      const enemySeat = other(seat);
      const effect = effects[seat];
      for (let attackerIndex = 0; attackerIndex < 5; attackerIndex++) {
        const attacker = teams[seat][attackerIndex];
        if (attacker.hp <= 0) continue;
        const targetIndex = pickTarget(room, attacker, teams[enemySeat], seat, effect);
        if (targetIndex === null) continue;
        const target = teams[enemySeat][targetIndex];
        let hit = damageProfile(attacker, target).total * .5 * (.94 + random(room) * .12);
        if (attacker.isHuman) {
          hit *= effect.attack;
          if (ticks < 8) hit *= effect.openingAttack;
          if (isBackline(target.champion)) hit *= effect.backline;
          if (isFrontline(target.champion)) hit *= effect.frontline;
          if (attacker.itemIds.includes('3084') && isFrontline(target.champion) && ticks % 5 === 0 && steelHits[seat] < 6) steelHits[seat] += Math.max(1, Math.round(effect.steel));
        } else hit *= effect.teamAttack * (ticks < 8 ? 1 + (effect.openingAttack - 1) * .4 : 1);
        if (target.isHuman) hit *= effects[enemySeat].extraRisk / effects[enemySeat].defense;
        else hit /= effects[enemySeat].teamDefense;
        if (target.champion.id === room.players[seat].targetId) hit *= attacker.isHuman ? effect.focusDamage * 1.06 : 1 + (effect.focusDamage - 1) * .5;
        incoming[enemySeat][targetIndex] += hit;
        attacker.damage += hit;
        if (!killers[enemySeat][targetIndex] || hit > killers[enemySeat][targetIndex].hit) killers[enemySeat][targetIndex] = { attackerIndex, hit };
      }
    }
    for (const seat of [0, 1]) {
      for (let index = 0; index < 5; index++) {
        const target = teams[seat][index];
        if (target.hp <= 0) continue;
        const before = target.hp;
        target.hp -= incoming[seat][index];
        if (before > 0 && target.hp <= 0) {
          const killer = killers[seat][index];
          if (killer) teams[other(seat)][killer.attackerIndex].kills++;
          if (events.length < 8) events.push(`${room.players[other(seat)].name}方击倒${target.champion.name}`);
        }
      }
      const hero = teams[seat][0];
      if (hero.hp > 0) {
        const heal = hero.panel.stats.lifesteal / 100 * hero.damage * .0015 + effects[seat].sustain * hero.maxHp * .008;
        hero.hp = Math.min(hero.maxHp, hero.hp + heal);
      }
      const support = teams[seat].find(unit => unit.hp > 0 && unit.champion.tags.includes('Support'));
      const living = teams[seat].filter(unit => unit.hp > 0);
      if (support && living.length) {
        const patient = living.reduce((a, b) => a.hp / a.maxHp < b.hp / b.maxHp ? a : b);
        patient.hp = Math.min(patient.maxHp, patient.hp + (20 + support.panel.stats.ap * .06) * effects[seat].teamDefense);
      }
    }
  }
  const strength = teams.map(team => team.reduce((sum, unit) => sum + Math.max(0, unit.hp) / unit.maxHp, 0));
  const kills = teams.map(team => team.reduce((sum, unit) => sum + unit.kills, 0));
  const winner = strength[0] === strength[1] ? (kills[0] === kills[1] ? Math.floor(random(room) * 2) : (kills[0] > kills[1] ? 0 : 1)) : (strength[0] > strength[1] ? 0 : 1);
  room.score[winner]++;
  room.winStreak[winner]++;
  room.winStreak[other(winner)] = 0;
  const report = {
    round: room.round, winner, seconds: ticks * .5,
    teams: teams.map((team, seat) => ({
      seat, kills: kills[seat], remaining: team.filter(unit => unit.hp > 0).length,
      playerKills: team[0].kills, playerDamage: Math.round(team[0].damage),
      playerDeaths: team[0].hp <= 0 ? 1 : 0,
      units: team.map(unit => ({ championId: unit.champion.id, name: unit.champion.name, hp: Math.max(0, Math.round(unit.hp)), kills: unit.kills })),
    })),
    focus: room.players.map((player, seat) => {
      const unit = teams[other(seat)].find(entry => entry.champion.id === player.targetId);
      return { seat, championId: player.targetId, name: unit.champion.name, killed: unit.hp <= 0 };
    }),
    tactics: room.players.map(player => ({ seat: player.seat, ...player.tactics })),
    objectives: [], events, score: { ...room.score }, towers: { ...room.towers },
    economy: room.players.map((player, seat) => {
      const base = 1500;
      const winBonus = winner === seat ? 1100 : 400;
      const killBonus = teams[seat][0].kills * 250;
      const assists = Math.min(5, Math.max(0, kills[seat] - teams[seat][0].kills));
      const assistBonus = assists * 120;
      const streakBonus = winner === seat ? Math.min(900, Math.max(0, room.winStreak[seat] - 1) * 300) : 0;
      const total = base + winBonus + killBonus + assistBonus + streakBonus;
      player.gold += total;
      player.kills += teams[seat][0].kills;
      player.deaths += teams[seat][0].hp <= 0 ? 1 : 0;
      player.assists += assists;
      player.damage += Math.round(teams[seat][0].damage);
      return { seat, base, winBonus, killBonus, assistBonus, streakBonus, objectiveBonus: 0, total };
    }),
    growthEvents: [[], []],
  };
  for (const seat of [0, 1]) report.growthEvents[seat] = growthAfterFight(room.players[seat], teams[seat][0], Math.min(8, steelHits[seat]), report, db);
  report.events.unshift(`第 ${room.round} 波团战：${room.players[winner].name}方获胜；双方各以 1 名玩家和 4 名人机参战。`);
  return report;
}

function resolveObjectives(room, db) {
  const report = room.roundReport;
  const selected = room.players.map(player => player.objectiveId);
  const changes = [0, 0]; // changes[seat] damages that seat's own tower.
  const details = [];
  const backdoorSuccess = [false, false];
  for (const seat of [0, 1]) {
    const player = room.players[seat];
    const enemySeat = other(seat);
    const id = selected[seat];
    const won = report.winner === seat;
    const alive = report.teams[seat].remaining;
    let gold = 0, damage = 0, text = '';
    let backdoorChance = null;
    switch (id) {
      case 'push_tower': {
        const siege = player.tactics.finish === 'siege_ready' ? 1.3 : 1;
        damage = Math.round((won ? 19 + alive * 3 : 5 + alive * 2) * siege * (1 + room.control[seat] * .025));
        gold = won ? 700 + Math.min(250, damage * 7) : 150;
        text = won ? '赢下团战后带线推进，拆掉敌塔并拿到塔钱。' : '团战失利后冒险推进，仍造成少量塔伤害。';
        break;
      }
      case 'farm_wave': gold = won ? 1350 : 1000; text = '清理兵线，获得下一轮的装备资金。'; break;
      case 'take_camps': gold = won ? 900 : 400; room.control[seat] = clamp(room.control[seat] + (won ? 1 : 0), 0, 4); text = '争夺地图补给，提高下一波团战的阵地优势。'; break;
      case 'defend_tower': gold = won ? 400 : 550; text = '回防己方防御塔，减少对手本轮推进。'; break;
      case 'backdoor': {
        const gear = player.itemIds.filter(itemId => byId(db.items, itemId)?.category !== 'component').length;
        const profile = computeBuild({ champion: byId(db.champions, player.championId), level: player.level,
          items: player.itemIds.map(itemId => byId(db.items, itemId)).filter(Boolean),
          augments: player.augmentIds.map(augmentId => byId(db.augments, augmentId)).filter(Boolean), growth: player.growth });
        backdoorChance = clamp(.08 + (100 - room.towers[enemySeat]) * .0035 + alive * .045
          - report.teams[enemySeat].remaining * .035 + gear * .025 + (won ? .12 : 0)
          + room.control[seat] * .025 + (profile.stats.as > 1.25 ? .04 : 0)
          - (report.teams[seat].playerDeaths ? .12 : 0), .01, .86);
        backdoorChance = Number(backdoorChance.toFixed(2));
        backdoorSuccess[seat] = random(room) < backdoorChance;
        if (backdoorSuccess[seat]) {
          damage = room.towers[enemySeat]; gold = 900;
          text = `偷塔成功，摧毁敌方基地（推演成功率 ${Math.round(backdoorChance * 100)}%）。`;
        } else {
          changes[seat] += 12;
          text = `偷塔失败，己方防线暴露（推演成功率 ${Math.round(backdoorChance * 100)}%）。`;
        }
        break;
      }
    }
    changes[enemySeat] += damage;
    player.gold += gold;
    report.economy[seat].objectiveBonus = gold;
    report.economy[seat].total += gold;
    details.push({ seat, id, name: byId(OBJECTIVE_OPTIONS, id).name, gold, towerDamage: 0, ownTowerDamage: 0,
      text, backdoorChance, backdoorSuccess: id === 'backdoor' ? backdoorSuccess[seat] : null });
  }
  for (const seat of [0, 1]) {
    // Defending applies after both secret actions have been revealed.
    if (selected[seat] === 'defend_tower') changes[seat] = Math.round(changes[seat] * .25);
    else if (report.winner !== seat) changes[seat] += 7;
  }
  const before = { ...room.towers };
  for (const seat of [0, 1]) room.towers[seat] = clamp(room.towers[seat] - changes[seat], 0, 100);
  for (const seat of [0, 1]) {
    details[seat].towerDamage = before[other(seat)] - room.towers[other(seat)];
    details[seat].ownTowerDamage = before[seat] - room.towers[seat];
  }
  report.objectives = details;
  report.towers = { ...room.towers };
  report.events.push(...details.map(detail => `${room.players[detail.seat].name}：${detail.name}，金币 +${detail.gold}；${detail.text}`));
  if (room.round === room.maxRounds || room.towers[0] <= 0 || room.towers[1] <= 0) {
    const points = [0, 1].map(seat => room.score[seat] * 25 + (100 - room.towers[other(seat)]) * .8 + (room.control[seat] - room.control[other(seat)]) * 3);
    let winner;
    if (backdoorSuccess[0] !== backdoorSuccess[1]) winner = backdoorSuccess[0] ? 0 : 1;
    else if ((room.towers[0] <= 0) !== (room.towers[1] <= 0)) winner = room.towers[0] <= 0 ? 1 : 0;
    else if (points[0] !== points[1]) winner = points[0] > points[1] ? 0 : 1;
    else winner = report.winner;
    const reason = backdoorSuccess[winner] && !backdoorSuccess[other(winner)] ? '最终回合偷塔成功。'
      : room.towers[other(winner)] <= 0 && room.towers[winner] > 0 ? '摧毁敌方防御塔。'
      : '根据团战胜场、推进进度与地图控制综合判定。';
    room.result = { winner, score: { ...room.score }, towers: { ...room.towers }, reason };
  }
  room.history.push(clone(report));
}

export function viewDuel(room, seat, db) {
  if (!room.players[seat]) throw new Error('无效席位');
  const self = room.players[seat];
  const rival = room.players[other(seat)];
  const visibleOpponentBuild = rival?.publishedBuild || { itemIds: [], augmentIds: [], gold: 3500 };
  const toPublicPlayer = (player, own) => player ? {
    seat: player.seat, name: player.name, championId: player.championId,
    heroOffers: own ? player.heroOffers.map(id => byId(db.champions, id)) : [],
    augmentOffers: own ? player.augmentOffers.map(id => byId(db.augments, id)) : [],
    offerRarity: room.offerRarity, augmentRerollsRemaining: own ? player.augmentRerollsRemaining : 0,
    augmentIds: own ? [...player.augmentIds] : [...visibleOpponentBuild.augmentIds],
    itemIds: own ? [...player.itemIds] : [...visibleOpponentBuild.itemIds],
    gold: own ? player.gold : visibleOpponentBuild.gold,
    level: player.level, targetId: player.targetId, tactics: { ...player.tactics },
    objectiveId: room.phase === 'report' || room.phase === 'finished' ? player.objectiveId : null,
    allies: player.allies.map(championId => ({ championId })),
    growth: own ? { ...player.growth } : undefined,
    pendingHeroId: own ? player.pendingHeroId : undefined,
    pendingAugmentId: own ? player.pendingAugmentId : undefined,
    pendingTargetId: own ? player.pendingTargetId : undefined,
    pendingTacticId: own ? player.pendingTacticId : undefined,
    pendingObjectiveId: own ? player.pendingObjectiveId : undefined,
    kills: player.kills, deaths: player.deaths, assists: player.assists, damage: player.damage,
  } : null;
  return {
    code: room.code, status: room.status, phase: room.phase,
    round: room.round, maxRounds: room.maxRounds, revision: room.revision,
    locked: [...room.locked], you: toPublicPlayer(self, true), opponent: toPublicPlayer(rival, false),
    teams: room.players.filter(Boolean).map(player => ({ seat: player.seat,
      units: [player.championId, ...player.allies].filter(Boolean).map(championId => {
        const champion = byId(db.champions, championId);
        return { championId, name: champion?.name || championId, role: roleOf(champion) };
      }),
    })),
    tacticStage: room.tacticStage,
    options: {
      tactics: room.phase === 'tactic' ? TACTIC_OPTIONS[room.tacticStage] : [],
      objectives: room.phase === 'objective' ? getDuelObjectiveOptions(room) : [],
    },
    roundReport: room.roundReport ? clone(room.roundReport) : null,
    score: { ...room.score }, towers: { ...room.towers }, control: { ...room.control },
    history: room.history.map(entry => ({ round: entry.round, winner: entry.winner, score: entry.score, towers: entry.towers })),
    result: room.result ? { ...room.result } : null,
  };
}
