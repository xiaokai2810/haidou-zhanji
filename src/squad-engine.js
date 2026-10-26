import { clamp, computeBuild } from './model.js';
import { damageProfile } from './battle-engine.js';
import { getSynergies } from './standalone-engine.js';

// A deterministic, server-authoritative abstraction of seven large ARAM fights.
// Skill timings and positioning are modeled rather than a reproduction of Riot's engine.
export const LEVELS = [3, 5, 7, 11, 15, 18, 18];
export const TACTICS = [
  { id: 'balanced', name: '稳扎稳打', description: '保持阵型，跟随标记目标输出。' },
  { id: 'engage', name: '先手开团', description: '坦克/战士压制敌方第一轮输出，自己更容易被集火。' },
  { id: 'dive', name: '绕后切核心', description: '优先突入后排，刺客更擅长；承受更多反击。' },
  { id: 'poke', name: '远程消耗', description: '远程英雄开局消耗增强，近战强行消耗会损失输出。' },
  { id: 'kite', name: '拉扯走砍', description: '射手减少承伤并保持普攻；近战输出效率下降。' },
  { id: 'peel', name: '保护后排', description: '分担己方脆皮压力，降低个人输出；辅助和坦克更有效。' },
  { id: 'steel', name: '贴身叠钢', description: '牺牲部分伤害换取更多心之钢/成长触发，承担贴身风险。' },
  { id: 'burst', name: '交技能爆发', description: '前期集中技能爆发，后续进入输出空窗。' },
  { id: 'control', name: '留控制反打', description: '保留控制限制突进与爆发英雄，直接输出略低。' },
  { id: 'sustain', name: '拖长团战', description: '持续回复，适合坦克、吸血与成长体系；爆发较低。' },
  { id: 'execute', name: '收割残血', description: '目标降到低血量后追加伤害，更依赖队友压低血线。' },
  { id: 'split', name: '牵制留技能', description: '团战伤害下降，存活后推塔与最终偷塔更强。' },
];
export const OBJECTIVES = [
  { id: 'push_tower', name: '抱团推塔', description: '存活人数与团战胜势决定推进伤害，并获得塔钱。' },
  { id: 'farm_wave', name: '清线补经济', description: '全队得到额外金币，复活后也能收线。' },
  { id: 'take_camps', name: '控回血包与兵线', description: '存活队员占据桥面，争取下轮阵地优势与少量金币。' },
  { id: 'defend_tower', name: '回防守塔', description: '减少本轮敌方推塔伤害，并消除部分阵地劣势。' },
  { id: 'backdoor', name: '绕后偷塔', description: '第 6、7 轮开放；有存活者才能尝试，敌方回防会降低成功率。' },
];
const AUGMENT_ROUNDS = [1, 2, 4, 6];
const ROLES = ['Tank', 'Fighter', 'Mage', 'Marksman', 'Support'];
const PLANS = {
  Tank: ['3084', '3047', '3068', '3065', '3075', '2501'],
  Fighter: ['3078', '3111', '3053', '6333', '3074', '2501'],
  Mage: ['6653', '3020', '3089', '3135', '3157', '4628'],
  Marksman: ['6672', '3006', '3031', '3153', '3036', '3085'],
  Assassin: ['3142', '3158', '6692', '6676', '6696', '3036'],
  Support: ['6617', '3158', '3504', '3107', '2065', '3222'],
};
const ROLE_AUGMENTS = {
  Tank: ['goliath', 'celestial_body', 'quest_steel_your_heart', 'courage_of_the_colossus', 'recursion'],
  Fighter: ['blunt_force', 'goliath', 'draw_your_sword', 'deft', 'master_of_duality'],
  Mage: ['phenomenal_evil', 'witchful_thinking', 'jeweled_gauntlet', 'recursion', 'eureka'],
  Marksman: ['deft', 'double_tap', 'firebrand', 'blunt_force', 'critical_rhythm'],
  Assassin: ['blunt_force', 'thread_the_needle', 'jeweled_gauntlet', 'recursion'],
  Support: ['recursion', 'critical_healing', 'first_aid_kit', 'windspeakers_blessing', 'goliath'],
};
const EXPLICIT = new Set(['draw_your_sword', 'blunt_force', 'witchful_thinking', 'goliath', 'celestial_body', 'deft', 'recursion', 'infinite_recursion', 'phenomenal_evil', 'jeweled_gauntlet', 'double_tap', 'firebrand', 'critical_rhythm', 'quest_steel_your_heart', 'stackosaurusrex', 'eureka', 'mind_to_matter', 'master_of_duality', 'donation', 'transmute_prismatic', 'transmute_chaos', 'critical_healing', 'first_aid_kit', 'lich_brain', 'gift_of_the_drowned', 'no_mana_no_problem', 'double_time', 'heavy_is_the_crown', 'weapon_of_destiny', 'armored_impact', 'jeweled_bracelet', 'group_hug', 'soul_eater', 'slap_around']);
export const isModeledAugment = id => EXPLICIT.has(id);
export const isPurchasableSquadItem = item => Boolean(item && item.purchasable !== false && !item.tags?.includes('Consumable') && ['starter', 'component', 'legendary', 'boots'].includes(item.category) && (item.shopCost ?? item.gold) > 0);
const clone = value => JSON.parse(JSON.stringify(value));
const byId = (rows, id) => rows.find(row => row.id === id);
const roleOf = champion => champion?.tags?.find(tag => PLANS[tag]) || 'Fighter';
const frontline = champion => champion.tags.some(tag => ['Tank', 'Fighter'].includes(tag));
const backline = champion => champion.tags.some(tag => ['Mage', 'Marksman', 'Support'].includes(tag));
function seedNumber(seed) {
  let n = 2166136261;
  for (const c of String(seed ?? 'squad')) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15;
  return (n >>> 0) || 0x6d2b79f5;
}
function random(game) {
  let x = game.rng >>> 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  game.rng = x >>> 0; return game.rng / 0x100000000;
}
function draw(game, pool) {
  if (!pool.length) throw new Error('候选池不足');
  return pool.splice(Math.floor(random(game) * pool.length), 1)[0];
}
function newHero(index) {
  return { index, championId: null, level: LEVELS[0], heroOffers: [], heroRerollsRemaining: 1,
    augmentOffers: [], augmentRerollsRemaining: 0, augmentPicked: false, augmentIds: [], itemIds: [],
    gold: 2200, totalGold: 2200, growth: {}, tacticId: 'balanced', targetId: 'frontline',
    kills: 0, deaths: 0, assists: 0, damage: 0, achievements: [], seenAugmentIds: [], published: null };
}
function heroOffers(game, team, index, db) {
  const assigned = new Set(game.teams.flatMap(t => t.heroes.flatMap(h => [h.championId, ...h.heroOffers])));
  const pool = db.champions.filter(c => !assigned.has(c.id));
  if (pool.length < 2) throw new Error('英雄目录至少需要 22 名英雄');
  game.teams[team].heroes[index].heroOffers = [draw(game, pool).id, draw(game, pool).id];
}
export function createSquad({ db, seed }) {
  if (!db?.champions?.length || !db?.items?.length || !db?.augments?.length) throw new Error('缺少游戏数据');
  const game = { version: 2, mode: 'squad', rng: seedNumber(seed), phase: 'draft', round: 1,
    maxRounds: 7, level: LEVELS[0], revision: 1, offerRarity: null, roundReport: null,
    history: [], result: null, teams: [0, 1].map(id => ({ id, heroes: Array.from({length: 5}, (_, i) => newHero(i)),
      ready: false, score: 0, baseHp: 100, momentum: 0, objectiveId: null, winStreak: 0, deaths: 0 })) };
  for (let team = 0; team < 2; team++) for (let i = 0; i < 5; i++) heroOffers(game, team, i, db);
  return game;
}
function publish(game) {
  for (const team of game.teams) for (const hero of team.heroes) hero.published = {
    championId: hero.championId, itemIds: [...hero.itemIds], augmentIds: [...hero.augmentIds], gold: hero.gold,
  };
}
function phase(game, next) { game.phase = next; for (const team of game.teams) team.ready = false; }
function prepareAugments(game, db) {
  const roll = random(game);
  game.offerRarity = roll < .35 ? 'silver' : roll < .8 ? 'gold' : 'prismatic';
  phase(game, 'augment');
  for (const team of game.teams) for (const hero of team.heroes) {
    hero.augmentPicked = false; hero.augmentRerollsRemaining = 1; hero.seenAugmentIds = [];
    augmentOffers(game, hero, db);
  }
}
function augmentOffers(game, hero, db) {
  let pool = db.augments.filter(a => a.rarity === game.offerRarity && !hero.augmentIds.includes(a.id) && !hero.seenAugmentIds.includes(a.id));
  if (pool.length < 3) pool = db.augments.filter(a => a.rarity === game.offerRarity && !hero.augmentIds.includes(a.id));
  if (pool.length < 3) throw new Error('本阶海克斯少于三种');
  hero.augmentOffers = Array.from({length: 3}, () => draw(game, pool).id);
  hero.seenAugmentIds.push(...hero.augmentOffers);
}
function selectAugment(game, hero, id, db) {
  if (hero.augmentPicked || !hero.augmentOffers.includes(id)) throw new Error('只能选择当前三选一候选中的海克斯');
  let selected = [id];
  if (['transmute_prismatic', 'transmute_chaos'].includes(id)) {
    const pool = db.augments.filter(a => !hero.augmentIds.includes(a.id) && !a.id.startsWith('transmute_') && (id === 'transmute_chaos' || a.rarity === 'prismatic'));
    selected = Array.from({length: id === 'transmute_chaos' ? 2 : 1}, () => draw(game, pool).id);
    hero.lastTransmute = { from: id, to: selected };
  } else hero.lastTransmute = null;
  hero.augmentIds.push(...selected); hero.augmentPicked = true;
  hero.augmentSelections = (hero.augmentSelections || 0) + 1;
  hero.augmentOffers = [];
  const bonus = selected.reduce((sum, value) => sum + ({ donation: 1750, upgrade_infinity_edge: 500, upgrade_collector: 250, upgrade_immolate: 250, upgrade_sheen: 250 }[value] || 0), 0);
  hero.gold += bonus; hero.totalGold += bonus;
}

function buy(hero, id, db) {
  const item = byId(db.items, id);
  if (!isPurchasableSquadItem(item)) throw new Error('该装备无法购买；药水、合剂等消耗品暂不计入七波模拟');
  if (['legendary', 'boots'].includes(item.category) && hero.itemIds.includes(id)) throw new Error('同一种成装只能购买一件');
  const inventory = [...hero.itemIds];
  let discount = 0;
  for (const componentId of item.from || []) {
    const index = inventory.indexOf(componentId);
    if (index < 0) continue;
    inventory.splice(index, 1);
    const component = byId(db.items, componentId);
    discount += component?.shopCost ?? component?.gold ?? 0;
  }
  if (inventory.length >= 6) throw new Error('装备栏已满（6 件）');
  if (item.category === 'boots' && inventory.some(owned => byId(db.items, owned)?.category === 'boots')) throw new Error('只能穿一双鞋子');
  const cost = Math.max(0, (item.shopCost ?? item.gold) - discount);
  if (hero.gold < cost) throw new Error('金币不足');
  hero.gold -= cost; hero.itemIds = [...inventory, id];
}
function sell(hero, id, db) {
  const index = hero.itemIds.indexOf(id); const item = byId(db.items, id);
  if (index < 0 || !item) throw new Error('未持有这件装备');
  hero.itemIds.splice(index, 1); hero.gold += Math.floor((item.shopCost ?? item.gold) * .7);
  delete hero.growth[id]; delete hero.growth[`evolve:${id}`];
}
export function getHeroPanel(hero, game, db) {
  const champion = byId(db.champions, hero.championId);
  if (!champion) return null;
  const panel = computeBuild({ champion, level: game.level, augments: hero.augmentIds.map(id => byId(db.augments, id)).filter(Boolean),
    items: hero.itemIds.map(id => byId(db.items, id)).filter(Boolean), growth: hero.growth, targetArmor: 0, targetMr: 0 });
  // Explicit champion growth stays bounded; these are match-simulation stacks.
  const stacks = hero.growth.champion || 0;
  if (['Veigar', 'AurelionSol'].includes(champion.id)) panel.stats.ap += stacks;
  if (['Nasus', 'Senna', 'Smolder', 'Kindred'].includes(champion.id)) panel.stats.ad += stacks * (champion.id === 'Nasus' ? .25 : .45);
  if (['Sion', 'Chogath'].includes(champion.id)) panel.stats.hp += stacks * 6;
  if (champion.id === 'Thresh') { panel.stats.armor += stacks * .7; panel.stats.ap += stacks * .5; }
  if (['Yasuo', 'Yone'].includes(champion.id)) panel.stats.crit = Math.min(100, panel.stats.crit * 2);
  if (hero.augmentIds.includes('jeweled_gauntlet')) panel.stats.crit = Math.min(100, panel.stats.crit + 25);
  if (hero.augmentIds.includes('double_time')) panel.stats.mp += hero.growth.double_time || 0;
  if (hero.augmentIds.includes('soul_eater')) panel.stats.hp += Math.min(1200, hero.growth.soul_eater || 0) + (hero.augmentIds.indexOf('soul_eater') === 1 ? 300 : 0);
  if (hero.augmentIds.includes('slap_around')) {
    const force = Math.min(30, hero.growth.slap_around || 0) * 10;
    const bonusAd = Math.max(0, panel.stats.ad - panel.base.ad);
    const useAp = panel.stats.ap > bonusAd * 1.67 || (panel.stats.ap === bonusAd && champion.tags.some(tag => ['Mage', 'Support'].includes(tag)));
    if (useAp) panel.stats.ap += force; else panel.stats.ad += force * .6;
  }
  // Apply each conversion once; a stat-conversion loop cannot recursively recalculate itself.
  const ownedItems = hero.itemIds.map(id => byId(db.items, id)).filter(Boolean);
  const itemHp = ownedItems.reduce((sum, item) => sum + (item.stats.FlatHPPoolMod || 0), 0);
  const itemMp = ownedItems.reduce((sum, item) => sum + (item.stats.FlatMPPoolMod || 0), 0);
  if (hero.augmentIds.includes('gift_of_the_drowned')) {
    panel.stats.hp = Math.max(panel.base.hp, panel.stats.hp - itemHp);
    panel.stats.lethality += 10 + (game.level - 1) * 15 / 17 + Math.min(75, itemHp * .05);
  }
  if (hero.augmentIds.includes('lich_brain')) panel.stats.ap += 30 + Math.min(160, Math.max(0, panel.stats.hp - panel.base.hp) * .04);
  if (hero.augmentIds.includes('no_mana_no_problem')) {
    panel.stats.mp = Math.max(panel.base.mp, panel.stats.mp - itemMp);
    panel.stats.ap = (panel.stats.ap + Math.min(200, itemMp * .08)) * 1.15;
  }
  if (hero.augmentIds.includes('heavy_is_the_crown')) {
    const crowns = hero.growth.heavy_is_the_crown || 0;
    panel.stats.ad += crowns * 2; panel.stats.ap += crowns * 3;
    panel.stats.as = Math.min(2.5, panel.stats.as * (1 + crowns * .015));
    panel.stats.move *= Math.max(.8, 1 - crowns * .007);
  }
  if (hero.augmentIds.includes('eureka')) panel.stats.haste += Math.min(150, panel.stats.ap * .30);
  if (hero.augmentIds.includes('mind_to_matter')) panel.stats.hp += Math.min(1000, panel.stats.mp * .5);
  const synergy = getSynergies({ player: hero }, db);
  panel.synergies = synergy;
  panel.notes.push('七波模拟采用有限触发：生命转法强最多额外 160，装备生命转穿甲最多 75，装备法力转法强最多 200，法强转急速最多 150；所有转换只计算一次。');
  if (hero.augmentIds.some(id => ['soul_eater', 'slap_around'].includes(id))) panel.notes.push('定身窗口按英雄控制能力、策略与急速估算，每波最多 12 次；吞噬灵魂永久生命最多 1200，第二个强化另加 300；扇巴掌最多 30 层，阵亡损失一半。叠角龙只加速英雄自身技能成长。');
  panel.modeledAugments = hero.augmentIds.filter(id => EXPLICIT.has(id)).length;
  panel.coverage = hero.augmentIds.length ? panel.modeledAugments / hero.augmentIds.length : 1;
  return panel;
}

// Achievement chances are game design. They are never advertised as original-game proc rates.
export const ACHIEVEMENTS = [
  { id: 'stack_dragon', name: '叠上加叠', heroes: ['Nasus', 'Veigar', 'Smolder', 'Senna', 'Sion', 'Chogath', 'AurelionSol', 'Thresh'], augments: ['stackosaurusrex'], detail: '成长英雄遇到叠角龙，额外收获一次有上限的成长。', probability: .35 },
  { id: 'steel_colossus', name: '钢铁巨像', heroes: ['Sion', 'Chogath', 'TahmKench', 'Mundo', 'DrMundo'], augments: ['quest_steel_your_heart'], items: ['3084'], detail: '成长坦克完成一次心之钢共鸣。', probability: .35 },
  { id: 'crit_sword', name: '疾风连斩', heroes: ['Yasuo', 'Yone'], augments: ['critical_rhythm'], items: ['3031'], detail: '暴击英雄、暴击律动与无尽之刃形成连续输出。', probability: .3 },
  { id: 'dual_cycle', name: '左脚踩右脚', heroes: ['Alistar', 'Syndra'], augments: ['slap_around', 'eureka'], detail: '控制叠加适应之力、法强转急速形成反馈；本站最多一次额外增幅 8%，不会无限增长。', probability: .3 },
  { id: 'evil_eureka', name: '知识就是力量', heroes: ['Veigar'], augments: ['phenomenal_evil', 'eureka'], detail: '成长法强转成技能急速，在有上限的模型中触发一次连招共鸣。', probability: .3 },
  { id: 'lich_colossus', name: '巫妖巨像', heroes: ['Sion', 'Chogath'], augments: ['lich_brain'], items: ['3084'], detail: '26.21 新增的额外生命转法强与心之钢成长形成共鸣。', probability: .3 },
  { id: 'burn_chain', name: '整座桥都在燃烧', heroes: ['Brand', 'Lillia', 'Singed'], augments: ['infernal_conduit'], items: ['6653'], detail: '持续伤害与灼烧装备触发连锁。', probability: .3 },
  { id: 'healing_crit', name: '生命的回声', heroes: ['Sona', 'Soraka', 'Seraphine', 'Nami'], augments: ['critical_healing'], items: ['6617'], detail: '治疗英雄、会心治疗与月石形成一次团队治疗共鸣。', probability: .3 },
].map(rule => ({...rule, maxPerHero: 1, model: '概率与收益为本站模拟规则；机制组合为资料推演', source: rule.id === 'lich_colossus' ? 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/' : `https://arammayhem.com/zh-cn/augments/${({stack_dragon:'stackosaurusrex',steel_colossus:'quest-steel-your-heart',crit_sword:'critical-rhythm',dual_cycle:'slap-around',evil_eureka:'eureka',burn_chain:'infernal-conduit',healing_crit:'critical-healing'})[rule.id]}/`}));
function procAchievements(game, db) {
  const events = [];
  for (const team of game.teams) for (const hero of team.heroes) {
    hero.roundProcs = [];
    for (const rule of ACHIEVEMENTS) {
      if (hero.achievements.includes(rule.id)) continue;
      if (!rule.heroes.includes(hero.championId) || !rule.augments.every(id => hero.augmentIds.includes(id)) || !(rule.items || []).every(id => hero.itemIds.includes(id))) continue;
      if (random(game) >= rule.probability) continue;
      hero.roundProcs.push(rule.id);
      const first = !hero.achievements.includes(rule.id);
      if (first) hero.achievements.push(rule.id);
      events.push({ id: rule.id, name: rule.name, detail: rule.detail, team: team.id, heroIndex: hero.index, first, probability: rule.probability, model: rule.model, source: rule.source });
    }
  }
  return events;
}
function combatant(hero, team, game, db) {
  const champion = byId(db.champions, hero.championId);
  const panel = getHeroPanel(hero, game, db);
  let attack = 1, defense = 1, sustain = 0;
  for (const id of hero.augmentIds) {
    if (EXPLICIT.has(id)) continue;
    const card = byId(db.augments, id); const text = `${card?.name || ''}${card?.effect || ''}`;
    const value = card?.rarity === 'prismatic' ? .04 : card?.rarity === 'gold' ? .03 : .02;
    if (/治疗|护盾|护甲|魔抗|生命值/.test(text)) defense += value;
    else if (/吸血|回复/.test(text)) sustain += value;
    else attack += value;
  }
  attack += clamp(panel.synergies.reduce((sum, s) => sum + s.attack, 0), 0, .2);
  defense += clamp(panel.synergies.reduce((sum, s) => sum + s.defense, 0), 0, .15);
  attack += Math.min(.08, (hero.roundProcs || []).length * .08);
  attack *= 1 + clamp(team.momentum, -2, 2) * .012;
  defense *= 1 + clamp(team.momentum, -2, 2) * .008;
  return { hero, champion, panel, team: team.id, index: hero.index, hp: panel.stats.hp, maxHp: panel.stats.hp,
    alive: true, damage: 0, taken: 0, kills: 0, assists: 0, secondsAlive: 0, steelHits: 0,
    controlHits: 0, nextControlAt: 1, initialSoul: hero.growth.soul_eater || 0, initialSlap: hero.growth.slap_around || 0,
    steelTargets: new Set(), contributions: new Set(), attack, defense, sustain, shieldUsed: false,
    lastHit: null, revived: false };
}
const CONTROL_CHAMPIONS = new Set(['Alistar','Syndra','Malphite','Amumu','Leona','Nautilus','Sejuani','Rell','Braum','Ornn','Sion','Chogath','Thresh','Blitzcrank','Maokai','Zac','Poppy','Rammus','Shen','Galio','Gragas','Nunu','TahmKench','Volibear','Udyr','Jax','Riven','Renekton','Irelia','Sett','JarvanIV','Vi','Warwick','Wukong','Darius','Aatrox','Camille','XinZhao','Pantheon','Yasuo','Yone','Qiyana','Ekko','Ahri','Annie','Anivia','AurelionSol','Azir','Brand','Cassiopeia','Hwei','Heimerdinger','Kennen','Lissandra','Lux','Malzahar','Morgana','Neeko','Orianna','Ryze','Seraphine','Swain','Taliyah','TwistedFate','Veigar','Velkoz','Vex','Viktor','Xerath','Ziggs','Zyra','Ashe','Aphelios','Caitlyn','Jhin','Jinx','Kalista','Senna','Varus','Vayne','Xayah','Bard','Ivern','Janna','Karma','Lulu','Milio','Nami','Rakan','Renata','Sona','Soraka','Taric','Yuumi','Zilean']);
function controlGrowth(unit, time, game, db) {
  if (!CONTROL_CHAMPIONS.has(unit.champion.id) || time < unit.nextControlAt || unit.controlHits >= 12 || !unit.hero.augmentIds.some(id => ['soul_eater','slap_around'].includes(id))) return;
  unit.controlHits++;
  const hero = unit.hero;
  if (hero.augmentIds.includes('soul_eater')) hero.growth.soul_eater = Math.min(1200, (hero.growth.soul_eater || 0) + 20);
  if (hero.augmentIds.includes('slap_around')) hero.growth.slap_around = Math.min(30, (hero.growth.slap_around || 0) + 1);
  const next = getHeroPanel(hero, game, db);
  const hpGain = Math.max(0, next.stats.hp - unit.maxHp);
  unit.maxHp = next.stats.hp; unit.hp = Math.min(unit.maxHp, unit.hp + hpGain); unit.panel = next;
  const roleWindow = unit.champion.tags.includes('Tank') || ['Alistar','Syndra','Veigar','Leona','Nautilus','Amumu'].includes(unit.champion.id) ? 7 : 10;
  const strategy = ['control','engage'].includes(hero.tacticId) ? 1.2 : 1;
  unit.nextControlAt = time + Math.max(1.5, roleWindow / (1 + Math.min(220, next.stats.haste) / 100) / strategy);
}
function chooseTarget(unit, enemies, game) {
  const alive = enemies.filter(e => e.alive);
  if (!alive.length) return null;
  const target = unit.hero.targetId;
  let chosen = typeof target === 'number' ? alive.find(e => e.index === target) : null;
  if (!chosen && target === 'weakest') chosen = alive.reduce((a, b) => a.hp / a.maxHp < b.hp / b.maxHp ? a : b);
  if (!chosen && target === 'backline') chosen = alive.find(e => backline(e.champion));
  if (!chosen && target === 'frontline') chosen = alive.find(e => frontline(e.champion));
  chosen ||= alive[0];
  const front = alive.find(e => frontline(e.champion));
  // A marked carry cannot be reached for free while a frontline still holds.
  if (front && backline(chosen.champion) && unit.hero.tacticId !== 'dive' && !unit.champion.tags.includes('Assassin') && random(game) < .58) chosen = front;
  return chosen;
}
function offense(unit, target, allies, enemies, tick, game) {
  const profile = damageProfile(unit, target);
  const s = unit.panel.stats; const id = unit.hero.tacticId;
  const ranged = unit.champion.stats.attackrange >= 400;
  let factor = unit.attack;
  if (id === 'engage') factor *= tick < 6 ? 1.1 : .96;
  if (id === 'dive') factor *= (backline(target.champion) ? 1.15 : .96) * (unit.champion.tags.includes('Assassin') ? 1.06 : 1);
  if (id === 'poke') factor *= tick < 8 ? (ranged ? 1.3 : .75) : .96;
  if (id === 'kite') factor *= ranged ? 1.04 : .85;
  if (id === 'peel') factor *= .86;
  if (id === 'steel') factor *= .92;
  if (id === 'burst') factor *= tick < 9 ? 1.3 : .87;
  if (id === 'control') factor *= .92;
  if (id === 'sustain') factor *= .93;
  if (id === 'execute') factor *= target.hp / target.maxHp < .35 ? 1.3 : .95;
  if (id === 'split') factor *= .88;
  const guardians = enemies.filter(e => e.alive && e.hero.tacticId === 'peel');
  if (backline(target.champion)) factor *= Math.max(.76, 1 - guardians.length * .075);
  const controllers = enemies.filter(e => e.alive && (e.hero.tacticId === 'control' || (tick < 5 && e.hero.tacticId === 'engage')));
  if (['dive', 'burst', 'engage'].includes(id)) factor *= Math.max(.8, 1 - controllers.length * .07);
  if (unit.hero.augmentIds.includes('double_tap')) factor *= 1.12;
  if (unit.hero.augmentIds.includes('critical_rhythm')) factor *= 1 + Math.min(.18, tick * .003 * (s.crit / 100 + .3));
  if (unit.hero.augmentIds.includes('master_of_duality')) factor *= 1 + Math.min(.2, tick * .006);
  let dps = profile.total;
  if (unit.hero.augmentIds.includes('weapon_of_destiny') && unit.hero.itemIds.some(id => PLANS[roleOf(unit.champion)].includes(id))) factor *= 1 + Math.min(.15, (unit.hero.growth.weapon_of_destiny || 0) * .006);
  if (unit.hero.augmentIds.includes('armored_impact')) dps += unit.panel.stats.armor * .12 * 100 / (100 + target.panel.stats.armor);
  if (unit.hero.augmentIds.includes('jeweled_bracelet')) dps += profile.magic * Math.min(.2, .05 + s.crit / 100 * .15);
  if (unit.hero.augmentIds.includes('jeweled_gauntlet')) dps += profile.magic * s.crit / 100 * .75;
  if (unit.hero.itemIds.includes('3031')) dps += profile.physical * s.crit / 100 * .15;
  if (unit.hero.itemIds.includes('3153')) dps += target.hp * .018 * Math.min(s.as, 2.5) * 100 / (100 + target.panel.stats.armor);
  if (unit.hero.itemIds.includes('3115')) dps += (15 + s.ap * .15) * s.as * 100 / (100 + target.panel.stats.mr);
  if (unit.hero.itemIds.includes('6653')) dps += target.maxHp * .008 * 100 / (100 + target.panel.stats.mr);
  if (unit.hero.itemIds.includes('3068') && frontline(target.champion)) dps += (15 + unit.maxHp * .005) * 100 / (100 + target.panel.stats.mr);
  if (unit.hero.augmentIds.includes('firebrand')) dps += target.maxHp * Math.min(.012, tick * .0004);
  if (unit.hero.itemIds.includes('3084') && frontline(target.champion) && tick >= 3 && !unit.steelTargets.has(target.index)) {
    unit.steelTargets.add(target.index); unit.steelHits++;
    dps += (80 + unit.maxHp * .035) * 100 / (100 + target.panel.stats.armor) * 2;
  }
  const incoming = target.hero.tacticId === 'kite' ? .89 : target.hero.tacticId === 'dive' ? 1.13 : target.hero.tacticId === 'engage' ? 1.08 : target.hero.tacticId === 'steel' ? 1.06 : 1;
  return Math.max(1, dps * factor * incoming / target.defense * (.94 + random(game) * .12));
}
export function classifyOutcome(deaths) {
  const [a, b] = deaths;
  if (a === b) return { winner: null, labels: ['平局', '平局'] };
  const winner = a < b ? 0 : 1; const won = deaths[winner]; const lost = deaths[1 - winner];
  const winLabel = won <= 1 && lost - won >= 3 ? '大获全胜' : won >= 3 || lost - won === 1 ? '惨胜' : '胜利';
  const lossLabel = lost === 5 && won <= 1 ? '全军覆没' : lost - won === 1 ? '惜败' : '战败';
  const labels = []; labels[winner] = winLabel; labels[1 - winner] = lossLabel;
  return { winner, labels };
}
function fight(game, db) {
  const achievements = procAchievements(game, db);
  const squads = game.teams.map(team => team.heroes.map(hero => combatant(hero, team, game, db)));
  let elapsed = 0;
  const events = [];
  for (let tick = 0; tick < 100; tick++) {
    if (squads.some(team => team.every(unit => !unit.alive))) break;
    const time = tick * .5; elapsed = (tick + 1) * .5;
    const incoming = squads.map(team => team.map(() => []));
    const healing = squads.map(team => team.map(() => 0));
    for (let team = 0; team < 2; team++) for (const unit of squads[team]) {
      if (!unit.alive) continue;
      unit.secondsAlive += .5;
      const enemy = chooseTarget(unit, squads[1 - team], game);
      if (!enemy) continue;
      controlGrowth(unit, time, game, db);
      const hit = offense(unit, enemy, squads[team], squads[1 - team], time, game) * .5;
      incoming[1 - team][enemy.index].push({ from: unit, damage: hit });
      // Area damage makes mage compositions useful without granting fivefold full damage.
      if (unit.champion.tags.includes('Mage') || unit.hero.itemIds.includes('3085')) {
        const secondary = squads[1 - team].filter(e => e.alive && e.index !== enemy.index).slice(0, 2);
        for (const target of secondary) incoming[1 - team][target.index].push({from: unit, damage: hit * .14});
      }
      const sustainRate = clamp(unit.panel.stats.lifesteal / 100 * .3 + unit.sustain + (unit.hero.tacticId === 'sustain' ? .1 : 0), 0, .38);
      healing[team][unit.index] += hit * sustainRate;
      if (unit.champion.tags.includes('Support')) {
        const friend = squads[team].filter(h => h.alive).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        let heal = (6 + unit.panel.stats.ap * .022 + game.level * .8) * .5;
        if (unit.hero.itemIds.includes('6617')) heal *= 1.3;
        if (unit.hero.augmentIds.includes('critical_healing')) heal *= 1.25;
        if (unit.hero.augmentIds.includes('first_aid_kit')) heal *= 1.2;
        if ((unit.hero.roundProcs || []).includes('healing_crit')) heal *= 1.3;
        healing[team][friend.index] += heal;
        if (unit.hero.augmentIds.includes('group_hug')) {
          const secondary = squads[team].filter(h => h.alive && h.index !== friend.index).sort((a,b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (secondary) healing[team][secondary.index] += heal * .35;
        }
      }
    }
    const grievousByTeam = squads.map(squad => squad.some(e => e.alive && e.hero.itemIds.some(id => ['3075', '3165', '3033'].includes(id))));
    // Resolve all attacks from the same living snapshot, permitting mutual kills and draws.
    for (let team = 0; team < 2; team++) for (const unit of squads[team]) {
      if (!unit.alive) continue;
      const hits = incoming[team][unit.index];
      const hitTotal = hits.reduce((sum, hit) => sum + hit.damage, 0);
      let taken = hitTotal;
      let heal = healing[team][unit.index];
      if (grievousByTeam[1 - team]) heal *= .6;
      if (!unit.shieldUsed && unit.hp - taken < unit.maxHp * .3 && unit.hero.itemIds.includes('3053')) {
        taken = Math.max(0, taken - unit.maxHp * .18); unit.shieldUsed = true;
      }
      const actual = Math.min(taken, unit.hp + heal);
      unit.taken += actual;
      for (const hit of hits) {
        hit.from.damage += hitTotal > 0 ? actual * hit.damage / hitTotal : 0;
        unit.contributions.add(hit.from.index);
      }
      unit.hp = Math.min(unit.maxHp, Math.max(0, unit.hp - taken + heal));
      if (unit.hp <= 0) {
        unit.alive = false;
        const killer = [...hits].sort((a, b) => b.damage - a.damage)[0]?.from;
        if (killer) { killer.kills++; for (const index of unit.contributions) if (index !== killer.index) squads[1 - team][index].assists++; }
        events.push({ time: elapsed, type: 'kill', team: 1 - team, heroIndex: killer?.index ?? null, targetTeam: team, targetIndex: unit.index, text: `${byId(db.champions, unit.hero.championId).name} 在 ${elapsed.toFixed(1)} 秒阵亡` });
      }
    }
  }
  const deaths = squads.map(team => team.filter(h => !h.alive).length);
  const outcome = classifyOutcome(deaths);
  const loser = outcome.winner === null ? null : 1 - outcome.winner;
  const shutdown = loser !== null ? Math.min(500, game.teams[loser].winStreak * 180) : 0;
  const gold = [[], []]; const income = [[], []]; const growthEvents = [];
  const previousScores = game.teams.map(t => t.score);
  for (let team = 0; team < 2; team++) {
    const side = game.teams[team]; const won = outcome.winner === team;
    const previousGap = Math.max(0, previousScores[1 - team] - previousScores[team]);
    side.score += outcome.winner === null ? 1 : won ? (outcome.labels[team] === '大获全胜' ? 4 : outcome.labels[team] === '惨胜' ? 2 : 3) : 0;
    side.winStreak = won ? side.winStreak + 1 : 0;
    side.deaths += deaths[team];
    // Victory momentum is capped; comeback income prevents seven-round snowballs.
    side.momentum = clamp(side.momentum * .45 + (won ? 1 : outcome.winner === null ? 0 : -.5), -2, 2);
    for (const unit of squads[team]) {
      const hero = unit.hero;
      const breakdown = {base: 1600 + game.round * 180, victory: won ? 350 : 0, kills: unit.kills * 140, assists: Math.min(300, unit.assists * 50), shutdown: won ? shutdown : 0, comeback: won ? 0 : Math.min(400, previousGap * 70)};
      const reward = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
      income[team].push({...breakdown,total:reward});
      hero.gold += reward; hero.totalGold += reward; gold[team].push(reward);
      hero.kills += unit.kills; hero.deaths += unit.alive ? 0 : 1; hero.assists += unit.assists; hero.damage += Math.round(unit.damage);
      growHero(hero, unit, game, db, growthEvents, team);
    }
  }
  game.roundReport = { round: game.round, level: game.level, winner: outcome.winner, labels: outcome.labels,
    deaths, tactics: squads.map(team => team.map(unit => unit.hero.tacticId)), seconds: elapsed, survivors: squads.map(team => team.filter(h => h.alive).map(h => h.index)),
    heroStats: squads.map(team => team.map(h => ({ championId: h.hero.championId, kills: h.kills, deaths: h.alive ? 0 : 1,
      assists: h.assists, controlHits: h.controlHits, damage: Math.round(h.damage), remainingHp: Math.round(h.hp), maxHp: Math.round(h.maxHp), steelHits: h.steelHits }))),
    gold, income, shutdown, events, achievements, growthEvents, objectives: [], model: '死亡人数判胜 · 50 秒上限 · 技能/走位为抽象模拟' };
  phase(game, 'aftermath');
}
function growHero(hero, unit, game, db, events, team) {
  const add = (key, amount, cap, name) => {
    if (!amount) return;
    const old = hero.growth[key] || 0; const value = Math.min(cap, old + Math.round(amount));
    hero.growth[key] = value;
    if (value > old) events.push({ team, heroIndex: hero.index, key, amount: value - old, total: value, text: `${name} +${value - old}（累计 ${value}）` });
  };
  if (hero.augmentIds.includes('soul_eater')) {
    const gained = (hero.growth.soul_eater || 0) - unit.initialSoul;
    if (gained > 0) events.push({team,heroIndex:hero.index,key:'soul_eater',amount:gained,total:hero.growth.soul_eater,text:`吞噬灵魂 ${unit.controlHits} 次定身，永久生命 +${gained}（累计 ${hero.growth.soul_eater}）`});
  }
  if (hero.augmentIds.includes('slap_around')) {
    const beforeDeath = hero.growth.slap_around || 0;
    if (!unit.alive) hero.growth.slap_around = Math.floor(beforeDeath * .5);
    const total = hero.growth.slap_around || 0;
    events.push({team,heroIndex:hero.index,key:'slap_around',amount:total-unit.initialSlap,total,text:`扇巴掌 ${unit.controlHits} 次定身${unit.alive ? '' : `，阵亡损失 ${beforeDeath-total} 层`}；剩余 ${total} 层适应之力`});
  }
  const stackFactor = hero.augmentIds.includes('stackosaurusrex') ? 2 : 1;
  const steelFactor = (hero.tacticId === 'steel' ? 1.4 : 1) * (hero.augmentIds.includes('quest_steel_your_heart') ? 1.5 : 1);
  if (hero.itemIds.includes('3084')) add('3084', unit.steelHits * (22 + game.level * 2) * steelFactor, 2200, '心之钢生命');
  if (hero.augmentIds.includes('phenomenal_evil')) add('phenomenal_evil', Math.min(35, unit.secondsAlive / 2.5), 240, '超凡邪恶法强');
  if (hero.augmentIds.includes('infinite_recursion')) add('infinite_recursion', unit.kills + unit.assists, 35, '无限循环往复参与击杀');
  if (hero.itemIds.includes('126697')) add('126697', (unit.kills + Math.min(2, unit.assists)) * 3, 100, '狂妄攻击力');
  if (hero.itemIds.includes('6657')) add('6657', 2, 10, '时光之杖层数');
  if (hero.augmentIds.includes('double_time')) add('double_time', Math.min(180, unit.secondsAlive * 4), 900, '双重奏法力');
  if (hero.augmentIds.includes('weapon_of_destiny')) add('weapon_of_destiny', unit.kills + unit.assists, 25, '命定之器参团成长');
  if (hero.augmentIds.includes('heavy_is_the_crown')) {
    add('heavy_is_the_crown', unit.kills, 20, '王冠战利品');
    if (!unit.alive) hero.growth.heavy_is_the_crown = Math.floor((hero.growth.heavy_is_the_crown || 0) * .6);
  }
  if (['Nasus', 'Veigar', 'Smolder', 'Senna', 'Sion', 'Chogath', 'AurelionSol', 'Thresh', 'Kindred'].includes(hero.championId)) {
    const count = (8 + Math.min(20, unit.secondsAlive / 2) + unit.kills * 3) * stackFactor * ((hero.roundProcs || []).includes('stack_dragon') ? 1.25 : 1);
    add('champion', count, 350, '英雄永久成长');
  }
  for (const [base, evolved] of [['3004', '3042'], ['3119', '3121'], ['3003', '3040']]) {
    if (!hero.itemIds.includes(base) || !byId(db.items, evolved)) continue;
    const key = `evolve:${base}`; hero.growth[key] = (hero.growth[key] || 0) + 1;
    if (hero.growth[key] >= 2) {
      hero.itemIds = hero.itemIds.map(id => id === base ? evolved : id); delete hero.growth[key];
      events.push({ team, heroIndex: hero.index, key, text: `${byId(db.items, base).name} 已进化为 ${byId(db.items, evolved).name}` });
    }
  }
}
function finishObjectives(game) {
  const report = game.roundReport; const damage = [0, 0];
  for (let team = 0; team < 2; team++) {
    const side = game.teams[team]; const other = game.teams[1 - team]; const id = side.objectiveId;
    const survivors = report.survivors[team].length; const won = report.winner === team;
    let gold = 0; let dealt = 0; let success = true;
    if (id === 'push_tower' && survivors > 0) {
      const split = side.heroes.filter(h => h.tacticId === 'split' && report.survivors[team].includes(h.index)).length;
      dealt = Math.round((3 + survivors * 1.8 + split * 2) * (won ? 1.25 : .55));
      if (other.objectiveId === 'defend_tower') dealt = Math.round(dealt * .45);
      gold = dealt * 25;
    }
    if (id === 'farm_wave') gold = 450;
    if (id === 'take_camps') { gold = survivors * 55; side.momentum = clamp(side.momentum + survivors * .22, -2, 2); }
    if (id === 'defend_tower') { gold = 160; side.momentum = Math.max(-.4, side.momentum); }
    if (id === 'backdoor') {
      const split = side.heroes.some(h => h.tacticId === 'split' && report.survivors[team].includes(h.index));
      const chance = clamp(.28 + survivors * .06 + (split ? .18 : 0) - (other.objectiveId === 'defend_tower' ? .35 : 0), .05, .75);
      success = survivors > 0 && random(game) < chance;
      dealt = success ? 18 : 0; gold = success ? 200 : 0;
      if (!success) side.momentum = clamp(side.momentum - .4, -2, 2);
    }
    damage[1 - team] += dealt;
    for (const hero of side.heroes) { hero.gold += gold; hero.totalGold += gold; }
    report.objectives.push({ team, id, name: OBJECTIVES.find(o => o.id === id)?.name, damage: dealt, gold, success });
  }
  for (let team = 0; team < 2; team++) game.teams[team].baseHp = Math.max(game.round < 7 ? 5 : 0, game.teams[team].baseHp - damage[team]);
  report.baseHp = game.teams.map(t => t.baseHp); report.score = game.teams.map(t => t.score);
  game.history.push(clone(report));
  if (game.round === 7) {
    const [a, b] = game.teams;
    let winner = null; let reason = '基地耐久、团战积分与累计阵亡均相同，握手言和';
    if (a.baseHp !== b.baseHp) { winner = a.baseHp > b.baseHp ? 0 : 1; reason = '七波战罢，基地耐久更高'; }
    else if (a.score !== b.score) { winner = a.score > b.score ? 0 : 1; reason = '基地耐久相同，团战积分更高'; }
    else if (a.deaths !== b.deaths) { winner = a.deaths < b.deaths ? 0 : 1; reason = '基地与积分相同，累计阵亡更少'; }
    game.result = { winner, reason, score: [a.score, b.score], baseHp: [a.baseHp, b.baseHp], deaths: [a.deaths, b.deaths] };
  }
  publish(game); phase(game, 'report');
}
function advance(game, db) {
  switch (game.phase) {
    case 'draft': publish(game); prepareAugments(game, db); break;
    case 'augment': publish(game); phase(game, 'shop'); break;
    case 'shop': publish(game); phase(game, 'plan'); break;
    case 'plan': fight(game, db); break;
    case 'aftermath': finishObjectives(game); break;
    case 'report':
      if (game.result) { phase(game, 'finished'); break; }
      game.round++; game.level = LEVELS[game.round - 1]; game.roundReport = null;
      for (const team of game.teams) {
        team.objectiveId = null;
        for (const hero of team.heroes) { hero.level = game.level; hero.roundProcs = []; }
      }
      if (AUGMENT_ROUNDS.includes(game.round)) prepareAugments(game, db); else phase(game, 'shop');
      break;
    default: throw new Error('当前阶段无法推进');
  }
}
function ready(game, team) {
  const side = game.teams[team];
  if (game.phase === 'draft' && side.heroes.some(h => !h.championId)) throw new Error('请为五名英雄全部完成选择');
  if (game.phase === 'augment' && side.heroes.some(h => !h.augmentPicked)) throw new Error('请为五名英雄全部选择海克斯');
  if (game.phase === 'aftermath' && !side.objectiveId) throw new Error('请选择战后行动');
  if (game.phase === 'finished') throw new Error('对局已经结束');
  side.ready = true;
}
function recommendedItems(game, team, hero, db) {
  const enemies = game.teams[1 - team].heroes.map(h => byId(db.champions, h.championId)).filter(Boolean);
  const count = tag => enemies.filter(c => c.tags.includes(tag)).length;
  const physical = count('Marksman') + count('Fighter') + count('Assassin');
  const magical = count('Mage');
  const tanks = count('Tank') + count('Fighter');
  const healing = count('Support') >= 1 || enemies.some(c => ['Vladimir', 'Aatrox', 'Warwick', 'DrMundo', 'Swain', 'Briar'].includes(c.id));
  const role = roleOf(byId(db.champions, hero.championId));
  const mr = magical >= physical;
  const boots = mr ? '3111' : '3047';
  const plans = {
    Tank: ['3084', boots, mr ? '4401' : '3143', healing ? '3075' : '3068', mr ? '3065' : '2501', mr ? '2501' : '3065'],
    Fighter: ['3078', boots, '3053', mr ? '3156' : '6333', healing ? '6609' : '3074', '2501'],
    Mage: ['6653', '3020', tanks >= 2 ? '3135' : '3089', healing ? '3165' : '4628', tanks >= 2 ? '3089' : '3135', '3157'],
    Marksman: [tanks >= 2 ? '3153' : '6672', '3006', healing ? '3033' : '3036', '3031', tanks >= 2 ? '6672' : '3153', '3085'],
    Assassin: ['3142', boots, '6692', tanks >= 2 ? '3036' : '6676', '6696', mr ? '3156' : '3814'],
    Support: ['6617', '3158', physical >= 3 ? '3190' : '3107', healing ? '3165' : '3504', '2065', '3222'],
  };
  return [...new Set(plans[role])].filter(id => {
    const item = byId(db.items, id);
    return item && item.purchasable !== false && ['legendary', 'boots'].includes(item.category);
  });
}
function autoHeroInternal(game, team, index, db) {
  const hero = game.teams[team].heroes[index];
  if (game.phase === 'draft') {
    if (hero.championId) return;
    const roles = game.teams[team].heroes.filter(h => h.championId).map(h => roleOf(byId(db.champions, h.championId)));
    const desired = ROLES[index];
    if (hero.heroRerollsRemaining > 0 && !hero.heroOffers.some(id => byId(db.champions, id).tags.includes(desired))) {
      heroOffers(game, team, index, db); hero.heroRerollsRemaining--;
    }
    const sorted = hero.heroOffers.map(id => byId(db.champions, id)).sort((a, b) => {
      const score = c => (c.tags.includes(desired) ? 5 : 0) + (roles.includes(roleOf(c)) ? 0 : 3);
      return score(b) - score(a);
    });
    hero.championId = sorted[0].id;
  } else if (game.phase === 'augment') {
    if (hero.augmentPicked) return;
    const role = roleOf(byId(db.champions, hero.championId)); const preferences = ROLE_AUGMENTS[role];
    const rank = id => { const index = preferences.indexOf(id); return index < 0 ? 0 : 100 - index; };
    const chosen = [...hero.augmentOffers].sort((a, b) => rank(b) - rank(a))[0];
    selectAugment(game, hero, chosen, db);
  } else if (game.phase === 'shop') {
    const role = roleOf(byId(db.champions, hero.championId));
    const ids = recommendedItems(game, team, hero, db);
    // Recycle starter items in the late game; each purchase still pays the real shop price.
    if (game.round >= 4) for (const id of [...hero.itemIds]) if (byId(db.items, id)?.category === 'starter') sell(hero, id, db);
    for (const id of ids) {
      if (hero.itemIds.includes(id)) continue;
      if (hero.itemIds.length >= 6 && game.round >= 4) {
        const obsolete = hero.itemIds.find(owned => !ids.includes(owned));
        const old = byId(db.items, obsolete); const upgrade = byId(db.items, id);
        if (old && hero.gold + Math.floor((old.shopCost ?? old.gold) * .7) >= (upgrade.shopCost ?? upgrade.gold)) sell(hero, obsolete, db);
      }
      try { buy(hero, id, db); } catch { /* Save for later. */ }
    }
    if (!hero.itemIds.length) {
      const starter = role === 'Mage' || role === 'Support' ? '1056' : role === 'Tank' ? '1054' : '1055';
      if (byId(db.items, starter)) try { buy(hero, starter, db); } catch { /* Price unavailable. */ }
    }
  } else if (game.phase === 'plan') {
    const role = roleOf(byId(db.champions, hero.championId));
    const opponents = game.teams[1 - team].heroes;
    const enemies = opponents.map(h => byId(db.champions, h.championId));
    const previous = game.history.at(-1)?.tactics?.[1 - team] || [];
    const divers = previous.filter(t => ['dive', 'burst'].includes(t)).length + enemies.filter(c => c.tags.includes('Assassin')).length;
    const fragile = enemies.filter(backline).length;
    hero.tacticId = {Tank: divers >= 2 ? 'control' : hero.itemIds.includes('3084') && game.round < 5 ? 'steel' : 'engage', Fighter: fragile >= 3 ? 'dive' : 'engage', Mage: fragile >= 4 ? 'burst' : 'poke', Marksman: 'kite', Assassin: 'dive', Support: 'peel'}[role];
    hero.targetId = role === 'Assassin' || role === 'Mage' ? 'backline' : role === 'Support' ? 'weakest' : 'frontline';
    if (['Assassin', 'Mage'].includes(role)) {
      const threats = opponents.map((enemy, i) => ({index: i, champion: enemies[i], damage: game.history.at(-1)?.heroStats?.[1 - team]?.[i]?.damage || 0})).filter(e => backline(e.champion));
      threats.sort((a,b) => b.damage - a.damage);
      if (threats.length) hero.targetId = threats[0].index;
    }
  } else throw new Error('当前阶段不能配置单个英雄');
}
export function autoHero(game, team, heroIndex, db) { return actSquad(game, {team, heroIndex, type: 'auto-hero'}, db); }
export function autoTeam(game, team, db) {
  if (![0, 1].includes(team)) throw new Error('无效队伍');
  if (game.teams[team].ready || game.phase === 'finished') return clone(game);
  let next = clone(game);
  if (['draft', 'augment', 'shop', 'plan'].includes(game.phase)) {
    for (let i = 0; i < 5; i++) autoHeroInternal(next, team, i, db);
  } else if (game.phase === 'aftermath') {
    const winners = next.roundReport.winner === team;
    const survivors = next.roundReport.survivors[team].length;
    next.teams[team].objectiveId = winners && survivors >= 2 ? 'push_tower' : next.round === 7 ? 'defend_tower' : 'farm_wave';
  }
  next = actSquad(next, {team, type: 'ready'}, db);
  return next;
}
export function actSquad(game, action, db) {
  const {team, type, heroIndex} = action || {};
  if (![0, 1].includes(team)) throw new Error('无效队伍');
  if (game.phase === 'finished') throw new Error('对局已经结束');
  if (game.teams[team].ready) throw new Error('本队已经准备，请等待另一队');
  const next = clone(game); const side = next.teams[team];
  const heroActions = ['pick-hero', 'reroll-hero', 'pick-augment', 'reroll-augment', 'buy', 'sell', 'plan', 'auto-hero'];
  if (heroActions.includes(type) && (!Number.isInteger(heroIndex) || heroIndex < 0 || heroIndex > 4)) throw new Error('无效英雄位置');
  const hero = side.heroes[heroIndex];
  const requirePhase = expected => { if (next.phase !== expected) throw new Error('当前阶段不能执行该操作'); };
  switch (type) {
    case 'pick-hero':
      requirePhase('draft');
      if (!hero.heroOffers.includes(action.championId)) throw new Error('只能选择随机候选英雄');
      hero.championId = action.championId; break;
    case 'reroll-hero':
      requirePhase('draft');
      if (hero.heroRerollsRemaining <= 0 || hero.championId) throw new Error('已选择英雄或重随机次数已用完');
      heroOffers(next, team, heroIndex, db); hero.heroRerollsRemaining--; break;
    case 'pick-augment': requirePhase('augment'); selectAugment(next, hero, action.augmentId, db); break;
    case 'reroll-augment':
      requirePhase('augment');
      if (hero.augmentPicked || hero.augmentRerollsRemaining <= 0) throw new Error('本次海克斯刷新次数已用完或已锁定');
      augmentOffers(next, hero, db); hero.augmentRerollsRemaining--; break;
    case 'buy': requirePhase('shop'); buy(hero, action.itemId, db); break;
    case 'sell': requirePhase('shop'); sell(hero, action.itemId, db); break;
    case 'plan':
      requirePhase('plan');
      if (!TACTICS.some(t => t.id === action.tacticId)) throw new Error('无效团战策略');
      if (!(Number.isInteger(action.targetId) && action.targetId >= 0 && action.targetId <= 4) && !['frontline', 'backline', 'weakest'].includes(action.targetId)) throw new Error('无效优先目标');
      hero.tacticId = action.tacticId; hero.targetId = action.targetId; break;
    case 'objective':
      requirePhase('aftermath');
      if (!OBJECTIVES.some(o => o.id === action.objectiveId) || (action.objectiveId === 'backdoor' && next.round < 6)) throw new Error('当前无法选择这个战后行动');
      side.objectiveId = action.objectiveId; break;
    case 'auto-hero': autoHeroInternal(next, team, heroIndex, db); break;
    case 'ready': ready(next, team); break;
    default: throw new Error('未知操作');
  }
  if (next.teams.every(t => t.ready)) advance(next, db);
  next.revision++;
  return next;
}
export function viewSquad(game, team) {
  const view = clone(game); view.youTeam = team;
  delete view.rng;
  const hidden = view.teams[1 - team];
  if (!hidden) return view;
  hidden.objectiveId = ['aftermath'].includes(game.phase) ? null : hidden.objectiveId;
  for (const hero of hidden.heroes) {
    hero.heroOffers = []; hero.augmentOffers = []; hero.seenAugmentIds = []; hero.lastTransmute = null;
    if (game.phase === 'draft') hero.championId = null;
    if (['augment', 'shop'].includes(game.phase) && hero.published) {
      hero.itemIds = [...hero.published.itemIds]; hero.augmentIds = [...hero.published.augmentIds]; hero.gold = hero.published.gold;
    }
    if (game.phase === 'plan') { hero.tacticId = null; hero.targetId = null; }
    delete hero.published;
  }
  return view;
}
