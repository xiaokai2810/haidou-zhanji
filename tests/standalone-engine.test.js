import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createStandaloneGame, swapHeroFromBench, chooseHero, rerollAugments,
  chooseAugment, buyItem, sellItem, getSynergies, startFight,
  chooseTactic, advanceRound, TACTIC_OPTIONS,
} from '../src/standalone-engine.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)));
const db = { champions: read('champions'), augments: read('augments'), items: read('items') };
const start = (seed = 103) => createStandaloneGame({ db, seed });
const toShop = (seed = 103) => {
  let game = start(seed);
  game = chooseHero(game, game.heroOffers[0].id, db);
  return chooseAugment(game, game.augmentOffers[0].id, db);
};
const finishFight = (game, choices, catalogue = db) => {
  let current = startFight(game, catalogue);
  for (const choice of choices) current = chooseTactic(current, choice, catalogue);
  return current;
};

test('seeded hero cards, shared bench exchange, and 5v5 matchmaking are reproducible', () => {
  const first = start('hero-seed');
  assert.deepEqual(first, start('hero-seed'));
  assert.equal(first.phase, 'hero_draft');
  assert.equal(first.heroOffers.length, 2);
  assert.equal(first.heroBench.length, 4);
  assert.equal(first.allies.length, 4);
  const benchId = first.heroBench[0].id;
  const offerId = first.heroOffers[0].id;
  const swapped = swapHeroFromBench(first, benchId, offerId, db);
  assert.equal(swapped.heroOffers[0].id, benchId);
  assert.equal(swapped.heroBench[0].id, offerId);
  assert.equal(first.heroOffers[0].id, offerId);
  assert.throws(() => chooseHero(first, benchId, db), /个人英雄卡/);
  const chosen = chooseHero(swapped, benchId, db);
  assert.equal(chosen.phase, 'augment_draft');
  assert.equal(chosen.player.championId, benchId);
  assert.equal(chosen.enemies.length, 5);
  assert.equal(new Set([chosen.player, ...chosen.allies, ...chosen.enemies].map(unit => unit.championId)).size, 10);
  assert.deepEqual(chosen.player.itemIds, []);
});

test('augment offers remain three unique cards with one adapted whole-set reroll', () => {
  let game = start(402);
  game = chooseHero(game, game.heroOffers[1].id, db);
  const firstIds = new Set(game.augmentOffers.map(card => card.id));
  const refreshed = rerollAugments(game, db);
  assert.equal(game.augmentRerollsRemaining, 1);
  assert.equal(refreshed.augmentRerollsRemaining, 0);
  assert.equal(refreshed.offerRarity, game.offerRarity);
  assert.ok(refreshed.augmentOffers.every(card => !firstIds.has(card.id)));
  assert.throws(() => rerollAugments(refreshed, db), /刷新次数/);
  assert.throws(() => chooseAugment(game, '__unoffered__', db), /当前三张/);
  const picked = chooseAugment(refreshed, refreshed.augmentOffers[0].id, db);
  assert.equal(picked.phase, 'shop');
  assert.equal(picked.player.augmentIds.length, 1);
});

test('immediate gold augments credit their stated amount when chosen', () => {
  const initial = start(514);
  const draft = chooseHero(initial, initial.heroOffers[0].id, db);
  const donation = db.augments.find(card => card.id === 'donation');
  const offered = { ...draft, augmentOffers: [donation, ...draft.augmentOffers.slice(1)] };
  const chosen = chooseAugment(offered, 'donation', db);
  assert.equal(chosen.player.gold, draft.player.gold + 1750);
  assert.ok(chosen.log.at(-1).text.includes('1750'));
});

test('components discount direct recipes, duplicate recipe inputs are consumed, and boots are limited', () => {
  const shop = toShop(801);
  const trinity = db.items.find(item => item.id === '3078');
  const sheen = db.items.find(item => item.id === '3057');
  const axe = db.items.find(item => item.id === '3044');
  let game = buyItem(shop, sheen.id, db);
  game = buyItem(game, axe.id, db);
  const before = game.player.gold;
  game = buyItem(game, trinity.id, db);
  assert.deepEqual(game.player.itemIds, [trinity.id]);
  assert.equal(game.player.gold, before - (trinity.gold - sheen.gold - axe.gold));
  assert.match(game.log.at(-1).text, /合成/);
  assert.deepEqual(shop.player.itemIds, []);
  const sold = sellItem(game, trinity.id, db);
  assert.equal(sold.player.gold, game.player.gold + Math.floor(trinity.gold * .7));

  let shoes = buyItem(shop, '1001', db);
  shoes = buyItem(shoes, '1042', db);
  shoes = buyItem(shoes, '1042', db);
  shoes = buyItem(shoes, '3006', db);
  assert.deepEqual(shoes.player.itemIds, ['3006']);
  assert.equal(shoes.player.gold, 3500 - db.items.find(item => item.id === '3006').gold);
  assert.throws(() => buyItem(shoes, '3047', db), /最多只能持有一双鞋子/);
  assert.throws(() => buyItem(shop, '3042', db), /可购装备/);
  assert.throws(() => buyItem(shop, '2003', db), /消耗品/);
});

test('tactical choices have three decision nodes and can reverse a result', () => {
  const shop = toShop(103);
  const a = startFight(shop, db);
  assert.equal(a.phase, 'tactic');
  assert.equal(a.tacticStage, 'engage');
  assert.ok(Object.values(TACTIC_OPTIONS).every(options => options.length >= 5));
  assert.throws(() => chooseTactic(a, 'not-a-choice', db), /当前阶段/);
  const b = chooseTactic(a, 'backline', db);
  assert.equal(b.tacticStage, 'response');
  assert.equal(b.pendingTactics.length, 1);
  const attack = finishFight(shop, ['backline', 'burst', 'chase']);
  const defend = finishFight(shop, ['guard', 'peel', 'disengage']);
  assert.equal(attack.phase, 'report');
  assert.equal(defend.phase, 'report');
  assert.notEqual(attack.lastRound.winner, defend.lastRound.winner);
  assert.notEqual(attack.lastRound.playerDamage, defend.lastRound.playerDamage);
  assert.deepEqual(shop.player.itemIds, []);
});

test('teamfight outcome, kills and assists produce an auditable next-round budget', () => {
  let game = finishFight(toShop(103), ['guard', 'peel', 'secure']);
  const record = game.lastRound;
  const income = record.economy;
  assert.equal(income.total, income.base + income.winBonus + income.killBonus + income.assistBonus);
  assert.equal(income.killBonus, record.playerKills * 250);
  assert.equal(income.assistBonus, record.playerAssists * 120);
  assert.equal(game.player.gold, 3500 + income.total);
  assert.equal(game.score.ally + game.score.enemy, 1);
  assert.ok(game.log.some(entry => entry.kind === 'economy' && entry.text.includes(String(income.total))));
  game = advanceRound(game, db);
  assert.equal(game.phase, 'augment_draft');
  assert.equal(game.round, 2);
  assert.equal(game.player.level, 7);
  assert.equal(game.augmentOffers.length, 3);
});

test('eleven official-inspired hero/item/augment examples trigger explicit explainable links', () => {
  const examples = [
    ['Yasuo', '3031', 'critical_rhythm', 'yasuo_crit'],
    ['Sion', '3084', 'quest_steel_your_heart', 'sion_steel'],
    ['Nasus', '3078', 'stackosaurusrex', 'nasus_stack'],
    ['Veigar', '3089', 'stackosaurusrex', 'veigar_stack'],
    ['Vayne', '3153', 'double_tap', 'vayne_double'],
    ['Jinx', '3085', 'firebrand', 'jinx_fire'],
    ['Lux', '4628', 'tripleshot', 'lux_triple'],
    ['Brand', '6653', 'infernal_conduit', 'brand_burn'],
    ['Sona', '6617', 'critical_healing', 'sona_heal'],
    ['Malphite', '3068', 'upgrade_immolate', 'sunfire_immolate'],
    ['Ezreal', '3004', 'skilled_sniper', 'ezreal_sniper'],
  ];
  const base = toShop(10);
  for (const [hero, item, augment, expected] of examples) {
    assert.ok(db.champions.some(champion => champion.id === hero));
    assert.ok(db.items.some(entry => entry.id === item));
    assert.ok(db.augments.some(entry => entry.id === augment));
    const game = { ...base, player: { ...base.player, championId: hero, itemIds: [item], augmentIds: [augment] } };
    const synergy = getSynergies(game, db).find(entry => entry.id === expected);
    assert.ok(synergy, expected);
    assert.ok(synergy.detail.length > 10);
    assert.ok(synergy.bonus.length > 0);
  }
  const common = { ...base, player: { ...base.player, championId: 'Yasuo', itemIds: ['3078'], augmentIds: [] } };
  assert.ok(getSynergies(common, db).some(entry => entry.id === 'fighter_trinity'));
});

test('heartsteel choices and quest feed permanent health into the following round', () => {
  let game = toShop(105);
  game = buyItem(game, '3084', db);
  game = { ...game, player: { ...game.player, augmentIds: ['quest_steel_your_heart'] } };
  const before = game.player.maxHp;
  game = finishFight(game, ['steel', 'steel', 'steel']);
  assert.ok(game.lastRound.steelHits > 0);
  assert.equal(game.lastRound.heartsteelHealthGained, game.lastRound.steelHits * 90);
  assert.equal(game.player.growth['3084'], game.lastRound.heartsteelHealthGained);
  game = advanceRound(game, db);
  assert.ok(game.player.maxHp > before);
});

test('a growth item progresses through two fights and becomes its evolved catalogue form', () => {
  let game = buyItem(toShop(212), '3004', db);
  assert.ok(game.player.itemIds.includes('3004'));
  game = finishFight(game, ['frontline', 'sustain', 'secure']);
  assert.equal(game.player.growth['evolve:3004'], 1);
  game = advanceRound(game, db);
  game = chooseAugment(game, game.augmentOffers[0].id, db);
  game = finishFight(game, ['frontline', 'sustain', 'secure']);
  assert.ok(game.player.itemIds.includes('3042'));
  assert.ok(!game.player.itemIds.includes('3004'));
  assert.ok(game.lastRound.growthEvents.some(entry => entry.includes('魔切')));
  assert.equal(game.player.growth['evolve:3004'], undefined);
});

test('four rounds end with a serializable win/loss record and no action after completion', () => {
  let game = start(922);
  game = chooseHero(game, game.heroOffers[0].id, db);
  for (let round = 1; round <= 4; round++) {
    assert.equal(game.phase, 'augment_draft');
    game = chooseAugment(game, game.augmentOffers[0].id, db);
    game = finishFight(game, ['frontline', 'sustain', 'counter']);
    assert.equal(game.phase, 'report');
    game = advanceRound(game, db);
  }
  assert.equal(game.phase, 'finished');
  assert.equal(game.rounds.length, 4);
  assert.equal(game.player.augmentIds.length, 4);
  assert.equal(game.score.ally + game.score.enemy, 4);
  assert.ok(['ally', 'enemy'].includes(game.result.winner));
  assert.deepEqual(JSON.parse(JSON.stringify(game)), game);
  assert.throws(() => startFight(game, db), /备战后/);
});
