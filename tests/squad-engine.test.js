import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSquad, actSquad, autoTeam, autoHero, viewSquad, getHeroPanel, LEVELS, classifyOutcome, ACHIEVEMENTS } from '../src/squad-engine.js';
const db = Object.fromEntries(['champions', 'items', 'augments'].map(key => [key, JSON.parse(fs.readFileSync(new URL(`../public/data/${key}.json`, import.meta.url)))]));
function until(game, target, catalog = db) {
  let steps = 0;
  while (game.phase !== target && steps++ < 120) {
    const team = game.teams[0].ready ? 1 : 0;
    game = autoTeam(game, team, catalog);
  }
  assert.equal(game.phase, target);
  return game;
}
function full(seed, catalog = db) { return until(createSquad({db: catalog, seed}), 'finished', catalog); }

test('seven full fights follow the requested levels; all ten units keep separate inventory and four selections with transmutation extras', () => {
  const game = full('seven-round-contract');
  assert.deepEqual(game.history.map(r => r.level), LEVELS);
  assert.equal(game.history.length, 7);
  assert.equal(game.round, 7);
  assert.ok(game.result);
  assert.equal(new Set(game.teams.flatMap(t => t.heroes.map(h => h.championId))).size, 10);
  for (const team of game.teams) for (const hero of team.heroes) {
    assert.equal(hero.augmentSelections, 4);
    assert.ok(hero.augmentIds.length >= 4 && hero.augmentIds.length <= 8);
    assert.ok(hero.itemIds.length <= 6 && hero.gold >= 0);
    assert.ok(hero.level === 18);
    assert.equal(hero.deaths, game.history.reduce((sum, report) => sum + report.heroStats[team.id][hero.index].deaths, 0));
  }
  for (const report of game.history) {
    assert.deepEqual(report.deaths, report.heroStats.map(rows => rows.reduce((sum, h) => sum + h.deaths, 0)));
    assert.equal(report.winner, report.deaths[0] === report.deaths[1] ? null : report.deaths[0] < report.deaths[1] ? 0 : 1);
    for (let t = 0; t < 2; t++) for (let i = 0; i < 5; i++) {
      const income = report.income[t][i];
      assert.equal(income.total, income.base + income.victory + income.kills + income.assists + income.shutdown + income.comeback);
      assert.equal(income.total, report.gold[t][i]);
    }
  }
});

test('server seed reproduces all offers, casualties, growth and rewards', () => {
  assert.deepEqual(full('same-seed'), full('same-seed'));
  assert.notDeepEqual(createSquad({db,seed:'a'}).teams, createSquad({db,seed:'b'}).teams);
});

test('one-hero automatic configuration cannot modify another hero or lock the team', () => {
  const original = createSquad({db,seed:52});
  const before = structuredClone(original);
  const next = autoHero(original, 0, 2, db);
  assert.deepEqual(original, before);
  assert.ok(next.teams[0].heroes[2].championId);
  assert.equal(next.teams[0].ready, false);
  for (const team of [0,1]) for (let index=0;index<5;index++) if (team !== 0 || index !== 2) assert.deepEqual(next.teams[team].heroes[index],original.teams[team].heroes[index]);
  assert.throws(() => actSquad(next,{team:0,type:'ready'},db), /五名/);
  assert.throws(() => autoHero(next,0,6,db), /英雄位置/);
});

test('random choices, one reroll, and four-slot augment progression are enforced', () => {
  let game = createSquad({db,seed:33});
  const offers = [...game.teams[0].heroes[0].heroOffers];
  assert.throws(() => actSquad(game,{team:0,heroIndex:0,type:'pick-hero',championId:'not-a-hero'},db), /随机/);
  game = actSquad(game,{team:0,heroIndex:0,type:'reroll-hero'},db);
  assert.ok(game.teams[0].heroes[0].heroOffers.every(id => !offers.includes(id)));
  assert.throws(() => actSquad(game,{team:0,heroIndex:0,type:'reroll-hero'},db), /次数/);
  game = until(game,'augment');
  const hero = game.teams[0].heroes[0];
  assert.equal(hero.augmentOffers.length,3);
  assert.ok(hero.augmentOffers.every(id=>db.augments.find(a=>a.id===id).rarity===game.offerRarity));
  const first = [...hero.augmentOffers];
  game = actSquad(game,{team:0,heroIndex:0,type:'reroll-augment'},db);
  assert.ok(game.teams[0].heroes[0].augmentOffers.every(id=>!first.includes(id)));
  assert.throws(()=>actSquad(game,{team:0,heroIndex:0,type:'reroll-augment'},db),/次数/);
  game = actSquad(game,{team:0,heroIndex:0,type:'pick-augment',augmentId:game.teams[0].heroes[0].augmentOffers[0]},db);
  assert.equal(game.teams[0].heroes[0].augmentOffers.length,0);
  assert.throws(()=>actSquad(game,{team:0,heroIndex:0,type:'pick-augment',augmentId:first[0]},db),/候选/);
});

test('shopping charges each hero, consumes components, rejects impossible buys and refunds at 70%', () => {
  let game = until(createSquad({db,seed:7}),'shop');
  const hero = game.teams[0].heroes[0];
  const component = db.items.find(i=>i.category==='component' && (i.shopCost??i.gold)<2000 && i.purchasable!==false);
  const cost = component.shopCost??component.gold;
  const gold = hero.gold;
  const other = structuredClone(game.teams[0].heroes[1]);
  game = actSquad(game,{team:0,heroIndex:0,type:'buy',itemId:component.id},db);
  assert.equal(game.teams[0].heroes[0].gold,gold-cost);
  assert.deepEqual(game.teams[0].heroes[1],other);
  game = actSquad(game,{team:0,heroIndex:0,type:'sell',itemId:component.id},db);
  assert.equal(game.teams[0].heroes[0].gold,gold-cost+Math.floor(cost*.7));
  assert.throws(()=>actSquad(game,{team:0,heroIndex:0,type:'buy',itemId:'fake'},db),/无法/);
  game.teams[0].heroes[0].gold=0;
  assert.throws(()=>actSquad(game,{team:0,heroIndex:0,type:'buy',itemId:component.id},db),/不足/);
  const upgrade = db.items.find(i=>i.category==='legendary' && i.purchasable!==false && i.from?.length && i.from.every(id=>db.items.some(c=>c.id===id)));
  const unit=game.teams[0].heroes[0]; unit.itemIds=[...upgrade.from];unit.gold=10000;
  const discount=upgrade.from.reduce((n,id)=>{const c=db.items.find(x=>x.id===id);return n+(c.shopCost??c.gold);},0);
  game=actSquad(game,{team:0,heroIndex:0,type:'buy',itemId:upgrade.id},db);
  assert.deepEqual(game.teams[0].heroes[0].itemIds,[upgrade.id]);
  assert.equal(game.teams[0].heroes[0].gold,10000-Math.max(0,(upgrade.shopCost??upgrade.gold)-discount));
});

test('opponent choices and RNG remain hidden until simultaneous commitment', () => {
  let game=createSquad({db,seed:71});
  game=autoHero(game,1,0,db);
  let view=viewSquad(game,0);
  assert.equal(view.rng,undefined); assert.equal(view.teams[1].heroes[0].championId,null); assert.deepEqual(view.teams[1].heroes[0].heroOffers,[]);
  game=until(game,'augment'); game=autoHero(game,1,0,db);
  view=viewSquad(game,0); assert.deepEqual(view.teams[1].heroes[0].augmentIds,[]);
  game=until(game,'shop'); game=autoHero(game,1,0,db);
  view=viewSquad(game,0); assert.deepEqual(view.teams[1].heroes[0].itemIds,[]);
  game=until(game,'plan'); game=actSquad(game,{team:1,heroIndex:0,type:'plan',tacticId:'dive',targetId:3},db);
  view=viewSquad(game,0);assert.equal(view.teams[1].heroes[0].tacticId,null);assert.equal(view.teams[1].heroes[0].targetId,null);
  assert.throws(()=>actSquad(game,{team:0,heroIndex:0,type:'plan',tacticId:'dive',targetId:9},db),/无效优先目标/);
});

test('death-count outcome includes overwhelming, costly victory and actual simulated draws', () => {
  assert.deepEqual(classifyOutcome([0,5]),{winner:0,labels:['大获全胜','全军覆没']});
  assert.deepEqual(classifyOutcome([4,5]),{winner:0,labels:['惨胜','惜败']});
  assert.deepEqual(classifyOutcome([5,2]),{winner:1,labels:['战败','胜利']});
  assert.deepEqual(classifyOutcome([5,5]),{winner:null,labels:['平局','平局']});
  const tankDb=structuredClone(db);
  for(const c of tankDb.champions){c.tags=['Tank'];c.stats.hp=1000000;c.stats.hpperlevel=0;c.stats.attackdamage=1;c.stats.attackdamageperlevel=0;}
  const game=full('nobody-dies',tankDb);
  for(const report of game.history){assert.deepEqual(report.deaths,[0,0]);assert.deepEqual(report.labels,['平局','平局']);assert.equal(report.seconds,50);}
  assert.equal(game.result.winner,null);
});

test('growth and achievements stay finite; an achievement is awarded once per hero per match', () => {
  let game=until(createSquad({db,seed:19}),'plan');
  for(const team of game.teams) for(const hero of team.heroes){hero.championId='Veigar';hero.augmentIds=['stackosaurusrex','phenomenal_evil','eureka'];hero.itemIds=['3089','3084'];}
  // Force an eligible first trigger while still evaluating the engine's real PRNG.
  game.rng=1;
  game=until(game,'finished');
  const seen=new Set();
  for(const report of game.history) for(const achievement of report.achievements){
    const key=`${achievement.team}/${achievement.heroIndex}/${achievement.id}`;
    assert.ok(!seen.has(key));seen.add(key);assert.equal(achievement.first,true);
  }
  assert.ok(seen.size>0);
  for(const team of game.teams) for(const hero of team.heroes){
    assert.ok((hero.growth.champion||0)<=350);assert.ok((hero.growth.phenomenal_evil||0)<=240);assert.ok((hero.growth['3084']||0)<=2200);
    for(const value of Object.values(getHeroPanel(hero,game,db).stats))assert.ok(Number.isFinite(value));
  }
  for(const a of ACHIEVEMENTS){assert.equal(a.maxPerHero,1);assert.ok(a.source.startsWith('https://'));assert.match(a.model,/模拟/);}
});

test('victory grants more base income, comeback is capped, and progress continues after a near-destroyed base', () => {
  let game=until(createSquad({db,seed:'economic-check'}),'plan');
  game.teams[0].baseHp=5;game.teams[1].baseHp=5;
  game.teams[0].score=0;game.teams[1].score=12;
  game=until(game,'aftermath');
  assert.ok(game.roundReport.income[0].every(i=>i.comeback<=400));
  if(game.roundReport.winner!==null)assert.ok(game.roundReport.income[game.roundReport.winner].every(i=>i.victory===350));
  game=until(game,'finished');
  assert.equal(game.history.length,7);
});

test('same seed and builds can reverse a fight when the team changes its combat choices', () => {
  let game=until(createSquad({db,seed:'strategy-1'}),'plan');
  for(let t=0;t<2;t++)for(let i=0;i<5;i++)game=autoHero(game,t,i,db);
  const resolve = source => actSquad(actSquad(source,{type:'ready',team:0},db),{type:'ready',team:1},db);
  const coordinated=resolve(game);
  let split=game;
  for(let i=0;i<5;i++)split=actSquad(split,{type:'plan',team:0,heroIndex:i,tacticId:'split',targetId:'backline'},db);
  const distracted=resolve(split);
  assert.equal(coordinated.roundReport.winner,0);
  assert.equal(distracted.roundReport.winner,1);
  assert.equal(game.rng,split.rng, 'planning itself must not consume combat RNG');
  assert.deepEqual(game.teams.map(t=>t.heroes.map(h=>h.itemIds)),split.teams.map(t=>t.heroes.map(h=>h.itemIds)));
});

test('26.21 chaos transmutation resolves two unique augments in one selection', () => {
  let game=until(createSquad({db,seed:234}),'augment');
  game.teams[0].heroes[0].augmentOffers=['transmute_chaos','deft','recursion'];
  game=actSquad(game,{team:0,heroIndex:0,type:'pick-augment',augmentId:'transmute_chaos'},db);
  const hero=game.teams[0].heroes[0];
  assert.equal(hero.augmentSelections,1);
  assert.equal(hero.augmentIds.length,2);
  assert.equal(new Set(hero.augmentIds).size,2);
  assert.ok(hero.augmentIds.every(id=>!id.startsWith('transmute_')));
  assert.equal(hero.augmentOffers.length,0);
});

test('stat conversion augments consume converted item stats and cannot loop to infinity', () => {
  const game=until(createSquad({db,seed:99}),'shop');
  const hero=game.teams[0].heroes[0];hero.itemIds=['3084','3003'];hero.augmentIds=[];
  const base=getHeroPanel(hero,game,db);
  hero.augmentIds=['gift_of_the_drowned','no_mana_no_problem','lich_brain','mind_to_matter','eureka'];
  const converted=getHeroPanel(hero,game,db);
  assert.ok(converted.stats.mp<base.stats.mp);
  assert.ok(converted.stats.lethality>base.stats.lethality);
  assert.ok(converted.stats.ap>base.stats.ap);
  assert.ok(converted.stats.haste<=base.stats.haste+150);
  assert.deepEqual(getHeroPanel(hero,game,db),converted);
});

test('Soul Eater second-slot 300 HP and control-triggered permanent growth are explicit', () => {
  let game=until(createSquad({db,seed:'cc-growth'}),'plan');
  const hero=game.teams[0].heroes[0];hero.championId='Alistar';hero.itemIds=['3084','3065','4401'];hero.augmentIds=['deft'];
  const initial=getHeroPanel(hero,game,db).stats.hp;
  hero.augmentIds.push('soul_eater');
  assert.equal(getHeroPanel(hero,game,db).stats.hp,initial+300);
  hero.tacticId='control';
  game=actSquad(actSquad(game,{type:'ready',team:0},db),{type:'ready',team:1},db);
  const after=game.teams[0].heroes[0];
  assert.ok(after.growth.soul_eater>0 && after.growth.soul_eater<=240);
  assert.equal(after.growth.soul_eater,game.roundReport.heroStats[0][0].controlHits*20);
  assert.ok(game.roundReport.growthEvents.some(e=>e.key==='soul_eater'&&e.team===0&&e.heroIndex===0));
  assert.equal(getHeroPanel(after,game,db).coverage,1);
});

test('Slap Around adaptive force feeds Eureka and loses half its stacks on death', () => {
  let game=until(createSquad({db,seed:'slap-cycle'}),'plan');
  const hero=game.teams[0].heroes[0];hero.championId='Syndra';hero.augmentIds=['slap_around','eureka'];hero.itemIds=[];
  const baseline=getHeroPanel(hero,game,db);
  hero.growth.slap_around=10;
  const stacked=getHeroPanel(hero,game,db);
  assert.equal(stacked.stats.ap,baseline.stats.ap+100);
  assert.equal(stacked.stats.haste,baseline.stats.haste+30);
  const fragileDb=structuredClone(db);fragileDb.champions.find(c=>c.id==='Syndra').stats.hp=1;
  game=actSquad(actSquad(game,{type:'ready',team:0},fragileDb),{type:'ready',team:1},fragileDb);
  const stats=game.roundReport.heroStats[0][0];const after=game.teams[0].heroes[0];
  assert.equal(stats.deaths,1);
  assert.equal(after.growth.slap_around,Math.floor(Math.min(30,10+stats.controlHits)*.5));
});

test('Stackosaurus only accelerates champion skill stacks, and consumables cannot occupy slots', async () => {
  const {isPurchasableSquadItem,isModeledAugment}=await import('../src/squad-engine.js');
  let game=until(createSquad({db,seed:'stack-scope'}),'shop');
  for(const item of db.items.filter(i=>i.category==='consumable'||i.tags?.includes('Consumable'))){
    assert.equal(isPurchasableSquadItem(item),false);
    assert.throws(()=>actSquad(game,{type:'buy',team:0,heroIndex:0,itemId:item.id},db),/消耗品/);
  }
  assert.equal(isModeledAugment('soul_eater'),true);assert.equal(isModeledAugment('slap_around'),true);
  game=until(game,'plan');
  // High HP keeps both variants alive for the full 50-second observation window.
  const tankDb=structuredClone(db);for(const c of tankDb.champions)c.stats.hp=1000000;
  const hero=game.teams[0].heroes[0];hero.championId='Nasus';hero.augmentIds=['phenomenal_evil'];hero.itemIds=[];
  const resolve=source=>actSquad(actSquad(source,{type:'ready',team:0},tankDb),{type:'ready',team:1},tankDb);
  const normal=resolve(game);
  const doubled=structuredClone(game);doubled.teams[0].heroes[0].augmentIds.push('stackosaurusrex');
  const accelerated=resolve(doubled);
  assert.equal(normal.teams[0].heroes[0].growth.phenomenal_evil,accelerated.teams[0].heroes[0].growth.phenomenal_evil);
  assert.ok(accelerated.teams[0].heroes[0].growth.champion>=normal.teams[0].heroes[0].growth.champion*2);
});
