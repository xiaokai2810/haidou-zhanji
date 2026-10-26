import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeBuild } from '../src/model.js';
const read = n => JSON.parse(readFileSync(new URL(`../public/data/${n}.json`, import.meta.url)));
const augments = read('augments'), items = read('items'), champions = read('champions'), meta = read('meta');
const hero = champions.find(c => c.id === 'Veigar');
const panel = (level, augmentIds = [], itemIds = [], growth = {}) => computeBuild({champion: hero, level, augments: augmentIds.map(id => augments.find(a => a.id === id)), items: itemIds.map(id => items.find(i => i.id === id)), growth});

test('26.21 snapshot includes all 35 announced additions, excludes retired cards and keeps valid IDs', () => {
  assert.equal(meta.patch, '26.21');
  assert.equal(augments.filter(a => a.isNew).length, 35);
  for (const a of augments) {
    assert.ok(a.effect && a.name && a.sourcePatch === '26.21', a.id);
    assert.ok(!meta.dataCoverage.removedFromOffers.includes(a.id), a.id);
  }
  for (const list of [champions, items, augments]) assert.equal(new Set(list.map(a => a.id)).size, list.length);
  for (const id of ['126697','123430','124011','3008','1086','1120']) assert.ok(items.some(i => i.id === id && i.purchasable), id);
});

test('early battle Witchful Thinking does not receive the level 18 maximum', () => {
  const early = panel(3, ['witchful_thinking']).stats.ap - panel(3).stats.ap;
  const late = panel(18, ['witchful_thinking']).stats.ap - panel(18).stats.ap;
  assert.ok(early > 20 && early < 40);
  assert.equal(late, 80);
});

test('26.21 item growth uses current mana, AP and health-to-attack conversions', () => {
  const base = panel(18, [], ['6657']);
  const grown = panel(18, [], ['6657'], {'6657': 10});
  assert.equal(grown.stats.hp - base.stats.hp, 100);
  assert.equal(grown.stats.mp - base.stats.mp, 300);
  assert.equal(grown.stats.ap - base.stats.ap, 30);
  const steel = panel(18, [], ['3084','2501'], {'3084':1000});
  const unstacked = panel(18, [], ['3084','2501']);
  assert.equal(steel.stats.ad - unstacked.stats.ad, 25);
});
