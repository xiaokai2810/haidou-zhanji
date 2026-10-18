import { clamp, computeBuild } from './model.js';
import { damageProfile } from './battle-engine.js';

// These are deliberately small, authored effects for a text game. The data
// catalogue's pickRate measures player selections, not augment offer odds.
const LEVELS = [1, 7, 11, 15];
const RARITIES = ['silver', 'gold', 'prismatic'];
const STAGES = ['engage', 'response', 'finish'];
const ROLES = ['Tank', 'Fighter', 'Mage', 'Marksman', 'Support'];
const BOT_ITEMS = {
  Tank: ['3084', '3065', '3075', '3143'],
  Fighter: ['3078', '3053', '3074', '6333'],
  Mage: ['6653', '3089', '3135', '3157'],
  Marksman: ['3046', '3031', '3153', '3036'],
  Assassin: ['3142', '6676', '6696', '3036'],
  Support: ['6617', '2065', '3107', '3504'],
};
// Opponents draft role-fit powers each round. Combat gives these catalogue
// cards small, explicit effects where the shared panel model has none.
const BOT_AUGMENTS = {
  Tank: ['divine_intervention', 'tank_it_or_leave_it', 'double_defense', 'courage_of_the_colossus'],
  Fighter: ['giant_slayer', 'firebrand', 'critical_rhythm', 'double_tap'],
  Mage: ['infernal_conduit', 'jeweled_gauntlet', 'firebrand', 'giant_slayer'],
  Marksman: ['double_tap', 'firebrand', 'giant_slayer', 'critical_rhythm'],
  Assassin: ['giant_slayer', 'firebrand', 'critical_rhythm', 'double_tap'],
  Support: ['our_healing', 'critical_healing', 'divine_intervention', 'infernal_conduit'],
};
const BOT_AUGMENT_COMBAT = {
  divine_intervention: { defense: .035 }, tank_it_or_leave_it: { defense: .02 },
  double_defense: { defense: .025 }, courage_of_the_colossus: { defense: .04 },
  our_healing: { receivedHealing: .04 }, critical_healing: { healing: .04 },
  giant_slayer: { giantDamage: .05 },
  firebrand: { attack: .025 }, critical_rhythm: { attack: .025 },
  double_tap: { attack: .025 }, infernal_conduit: { attack: .025 },
  jeweled_gauntlet: { attack: .04 },
};
const IMMEDIATE_AUGMENT_GOLD = {
  donation: 1750,
  upgrade_infinity_edge: 500,
  upgrade_collector: 250,
  upgrade_immolate: 250,
  upgrade_sheen: 250,
};

export const TACTIC_OPTIONS = {
  engage: [
    { id: 'backline', name: '切入后排', description: '优先攻击法师与射手；伤害更高，也更易承受集火。' },
    { id: 'frontline', name: '先破前排', description: '稳住阵线，针对坦克与战士持续输出。' },
    { id: 'flank', name: '侧翼包抄', description: '让队友一同压向侧翼；进攻增强，己方后排更暴露。' },
    { id: 'guard', name: '守住后排', description: '优先限制切入者，降低队友承受的伤害。' },
    { id: 'steel', name: '贴身叠钢', description: '贴近前排，为心之钢创造更多触发机会。' },
    { id: 'ambush', name: '草丛伏击', description: '开局一波爆发更强，但暴露后容易遭到反扑。' },
    { id: 'poke', name: '远程消耗', description: '远程英雄开战前压低血线；近战英雄难以发挥。' },
    { id: 'press', name: '正面压进', description: '全队抢先占据阵地，增加队友输出，也更容易挨打。' },
  ],
  response: [
    { id: 'burst', name: '集中爆发', description: '抢一波击倒，提升伤害，同时承担更多反打。' },
    { id: 'kite', name: '边打边退', description: '减少自身承伤；远程英雄更容易保持输出。' },
    { id: 'peel', name: '回身保护', description: '压低队友承伤，牺牲一部分个人输出。' },
    { id: 'sustain', name: '拉长交战', description: '拖延团战、获得少量回复，适合成长装备。' },
    { id: 'steel', name: '寻找心之钢窗口', description: '优先贴近可触发目标，承受额外风险。' },
    { id: 'interrupt', name: '留控制断招', description: '限制刺客或法师的关键技能，降低敌方爆发。' },
    { id: 'all_in', name: '孤注一掷', description: '投入所有技能争取击杀，显著提高个人输出与风险。' },
    { id: 'bait', name: '佯退反包', description: '诱敌深入后由队友合围，对突进阵容更有效。' },
  ],
  finish: [
    { id: 'chase', name: '追击残血', description: '争取击倒与击杀赏金；追深了也可能被反杀。' },
    { id: 'secure', name: '稳收战场', description: '集中队伍火力完成团战，个人击杀机会略少。' },
    { id: 'disengage', name: '果断撤退', description: '保住己方剩余战力，减少伤亡但放弃部分输出。' },
    { id: 'counter', name: '等待反打', description: '等敌方突进后反手反击，尤其克制刺客。' },
    { id: 'steel', name: '最后一次叠钢', description: '延长贴身时间，为下回合换取更多永久生命值。' },
    { id: 'execute', name: '集火斩杀目标', description: '全队追击标记目标，放弃部分阵地保护。' },
    { id: 'escort', name: '护送核心撤出', description: '保护己方残血并降低损失，团战伤害随之下降。' },
    { id: 'siege_ready', name: '留技能准备推塔', description: '收尾保留爆发，若赢下团战随后推塔更强。' },
  ],
};

export const OBJECTIVE_OPTIONS = [
  { id: 'push_tower', name: '带线推塔', description: '用存活队员冲击敌方防御塔，赢团后推进更快并获得塔钱。' },
  { id: 'farm_wave', name: '清线发育', description: '稳妥收集兵线经济，补齐下一轮装备。' },
  { id: 'take_camps', name: '争夺地图补给', description: '抢占回血包与关键位置，获取金币并提高下一轮团战的阵地优势。' },
  { id: 'defend_tower', name: '回防己塔', description: '减少敌方反推，保住基地防线。' },
  { id: 'backdoor', name: '孤身偷塔', description: '最终回合绕开正面战场直取敌塔；失败会给对手反推机会。' },
];

export function getObjectiveOptions(game) {
  return OBJECTIVE_OPTIONS.filter(option => option.id !== 'backdoor' || game.round === game.maxRounds);
}

const SYNERGY_RULES = [
  { id: 'yasuo_crit', title: '疾风与暴击律动', heroes: ['Yasuo', 'Yone'], items: ['3031'], augments: ['critical_rhythm'], attack: .07, detail: '亚索/永恩的暴击打法叠加无尽之刃与暴击律动；文字团战额外输出。' },
  { id: 'sion_steel', title: '塞恩的钢铁之心', heroes: ['Sion'], items: ['3084'], augments: ['quest_steel_your_heart'], defense: .05, steel: .30, detail: '塞恩的前排打法配合心之钢任务，贴身交战更容易累积永久生命值。' },
  { id: 'nasus_stack', title: '沙漠叠层', heroes: ['Nasus'], items: ['3078'], augments: ['stackosaurusrex'], attack: .06, detail: '内瑟斯的成长打法搭配三相之力与叠角龙，长线团战更有压迫力。' },
  { id: 'veigar_stack', title: '小法的成长法强', heroes: ['Veigar'], items: ['3089'], augments: ['stackosaurusrex'], attack: .06, detail: '维迦的成长法强经死亡之帽放大，与叠角龙形成后期火力。' },
  { id: 'vayne_double', title: '双发破败', heroes: ['Vayne'], items: ['3153'], augments: ['double_tap'], attack: .07, detail: '薇恩连续普攻配合破败与双发快射，持续输出更强。' },
  { id: 'jinx_fire', title: '金克丝的弹幕', heroes: ['Jinx'], items: ['3085'], augments: ['firebrand'], attack: .06, detail: '卢安娜的飓风与火上浇油使金克丝更适合多目标团战。' },
  { id: 'lux_triple', title: '三重远程压制', heroes: ['Lux'], items: ['4628'], augments: ['tripleshot'], attack: .06, detail: '拉克丝的远程技能结合视界专注与三重射击，适合后排集火。' },
  { id: 'brand_burn', title: '炼狱连锁', heroes: ['Brand'], items: ['6653'], augments: ['infernal_conduit'], attack: .07, detail: '布兰德持续灼烧搭配兰德里与炼狱导管，扩大团战持续伤害。' },
  { id: 'sona_heal', title: '会心治疗', heroes: ['Sona'], items: ['6617'], augments: ['critical_healing'], defense: .07, detail: '娑娜的群体治疗结合月石再生器与会心治疗，提升队伍生存。' },
  { id: 'sunfire_immolate', title: '献祭前排', heroes: ['Malphite', 'Amumu'], items: ['3068'], augments: ['upgrade_immolate'], attack: .04, defense: .04, detail: '墨菲特/阿木木持续贴身，日炎圣盾与献祭强化更易覆盖前排。' },
  { id: 'ezreal_sniper', title: '技能射手', heroes: ['Ezreal'], anyItems: ['3004', '3042'], augments: ['skilled_sniper'], attack: .07, detail: '伊泽瑞尔的远程技能配合魔宗（或进化后的魔切）与老练狙神，拉扯输出更强。' },
  { id: 'steel_quest', title: '钢化任务', items: ['3084'], augments: ['quest_steel_your_heart'], steel: .35, detail: '心之钢与钢化任务让每次有效触发更有价值。' },
  { id: 'giant_rift', title: '巨人体魄与持续战', items: ['4633'], augments: ['goliath'], attack: .04, defense: .03, detail: '歌利亚巨人的生命值与裂隙制造者相互配合，适合持久交战。' },
  { id: 'giant_bloodmail', title: '生命转攻击', items: ['2501'], augments: ['goliath'], attack: .05, detail: '歌利亚巨人提供更多生命值，霸王血铠把生命优势转成进攻。' },
  { id: 'deft_guinsoo', title: '高速连击', items: ['3124'], augments: ['deft'], attack: .05, detail: '灵巧与鬼索的狂暴之刃共同强化持续普攻。' },
  { id: 'giantslayer_bork', title: '巨人猎手', items: ['3153'], augments: ['giant_slayer'], attack: .05, detail: '破败王者之刃与巨人杀手都偏向对抗高生命目标。' },
  { id: 'tank_steel', title: '前排叠钢', tags: ['Tank'], items: ['3084'], defense: .04, steel: .08, detail: '坦克贴身承伤更容易留在心之钢触发范围；本站模型提高生存与叠层效率。' },
  { id: 'tank_goliath', title: '巨人体魄', tags: ['Tank'], augments: ['goliath'], defense: .04, detail: '坦克的承伤定位与歌利亚巨人的生命成长相互配合。' },
  { id: 'fighter_trinity', title: '战士连招', tags: ['Fighter'], items: ['3078'], attack: .04, detail: '战士频繁普攻和施法，更能发挥三相之力的交替输出节奏。' },
  { id: 'marksman_infinity', title: '射手暴击', tags: ['Marksman'], items: ['3031'], attack: .04, detail: '射手持续普攻搭配无尽之刃的暴击路线。' },
  { id: 'mage_deathcap', title: '法师高法强', tags: ['Mage'], items: ['3089'], attack: .04, detail: '法师技能受益于死亡之帽放大的法术强度。' },
  { id: 'support_moonstone', title: '团队治疗', tags: ['Support'], items: ['6617'], defense: .05, detail: '辅助在团战中持续治疗，月石再生器的路线强化团队生存。' },
  { id: 'assassin_youmuu', title: '刺客游击', tags: ['Assassin'], items: ['3142'], attack: .04, detail: '刺客利用幽梦之灵寻找侧翼进场机会。' },
  { id: 'marksman_deft', title: '灵巧射击', tags: ['Marksman'], augments: ['deft'], attack: .04, detail: '射手的持续普攻适合灵巧提供的攻击速度。' },
  { id: 'mage_jeweled', title: '法术暴击', tags: ['Mage'], augments: ['jeweled_gauntlet'], attack: .04, detail: '法师技能配合珠光护手的法术暴击路线。' },
  { id: 'fighter_sword', title: '近战决斗', tags: ['Fighter'], augments: ['draw_your_sword'], attack: .04, detail: '战士在近距离交锋中发挥亮出你的剑的战斗节奏。' },
  { id: 'tank_celestial', title: '巨额血量', tags: ['Tank'], augments: ['celestial_body'], defense: .04, detail: '坦克选择天体体魄时更适合吸收敌方第一轮火力。' },
];

const clone = value => JSON.parse(JSON.stringify(value));
const byId = (rows, id) => rows.find(row => row.id === id);
const roleOf = champion => champion.tags.find(tag => BOT_ITEMS[tag]) || 'Fighter';

function seedNumber(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  // Mix even nearby numeric seeds before xorshift's first draw. Without this,
  // seeds 1..300 repeatedly offer the same part of the champion pool.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) || 0x6d2b79f5;
}

function random(game) {
  let x = game.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  game.rng = x >>> 0;
  return game.rng / 0x100000000;
}

function drawOne(game, pool) {
  if (!pool.length) throw new Error('候选池不足，无法继续抽选');
  const index = Math.floor(random(game) * pool.length);
  return pool.splice(index, 1)[0];
}

function drawRoleChampion(game, db, used, role) {
  let pool = db.champions.filter(champion => !used.has(champion.id) && champion.tags[0] === role);
  if (!pool.length) pool = db.champions.filter(champion => !used.has(champion.id) && champion.tags.includes(role));
  if (!pool.length) pool = db.champions.filter(champion => !used.has(champion.id));
  const chosen = drawOne(game, pool);
  used.add(chosen.id);
  return chosen;
}

function makeUnit(championId, db, level, gold = 0) {
  const champion = byId(db.champions, championId);
  const panel = computeBuild({ champion, level, augments: [], items: [] });
  return {
    championId, level, itemIds: [], augmentIds: [], growth: {}, gold,
    hp: Math.round(panel.stats.hp), maxHp: Math.round(panel.stats.hp), kills: 0, deaths: 0, assists: 0,
  };
}

function panelFor(unit, db) {
  const champion = byId(db.champions, unit.championId);
  if (!champion) throw new Error(`找不到英雄 ${unit.championId}`);
  return computeBuild({
    champion, level: unit.level,
    augments: unit.augmentIds.map(id => byId(db.augments, id)).filter(Boolean),
    items: unit.itemIds.map(id => byId(db.items, id)).filter(Boolean),
    growth: unit.growth, targetArmor: 0, targetMr: 0,
  });
}

function syncUnit(unit, db, refill = false) {
  const hp = Math.round(panelFor(unit, db).stats.hp);
  unit.hp = refill ? hp : Math.min(unit.hp, hp);
  unit.maxHp = hp;
}

function drawAugments(game, db) {
  game.offerRarity = RARITIES[Math.floor(random(game) * RARITIES.length)];
  const seen = new Set([...game.seenAugmentIds, ...game.player.augmentIds]);
  const pool = db.augments.filter(card => card.rarity === game.offerRarity && !seen.has(card.id));
  if (pool.length < 3) throw new Error('当前稀有度的海克斯不足三张');
  game.augmentOffers = [];
  for (let index = 0; index < 3; index++) {
    const chosen = drawOne(game, pool);
    game.augmentOffers.push(chosen);
    game.seenAugmentIds.push(chosen.id);
  }
  game.augmentRerollsRemaining = 1;
}

/** Start an independent serializable story match; the hero is selected in game. */
export function createStandaloneGame({ db, seed = 1 }) {
  if (!db?.champions?.length || !db?.augments?.length || !db?.items?.length) throw new Error('缺少英雄、装备或海克斯目录');
  if (db.champions.length < 15) throw new Error('英雄目录不足，无法生成独立对局');
  const game = {
    version: 1, seed: String(seed), rng: seedNumber(seed), phase: 'hero_draft',
    round: 1, maxRounds: 4, player: null, allies: [], enemies: [],
    heroOffers: [], heroBench: [], augmentOffers: [], offerRarity: null,
    seenAugmentIds: [], augmentRerollsRemaining: 0,
    score: { ally: 0, enemy: 0 }, sideEconomy: { ally: 0, enemy: 0 },
    winStreak: { ally: 0, enemy: 0 }, towers: { ally: 100, enemy: 100 }, mapControl: 0,
    tacticStage: null, priorityTargetId: null, pendingTactics: [], rounds: [], lastRound: null,
    result: null, log: [{ kind: 'system', round: 1, text: '独立对局开始：随机两张个人英雄卡，队友未选的四张卡进入公共备选席。英雄抽样为本站模拟。' }],
  };
  const used = new Set();
  const pool = [...db.champions];
  for (let index = 0; index < 2; index++) {
    const hero = drawOne(game, pool);
    used.add(hero.id);
    game.heroOffers.push(hero);
  }
  // Four matched allies have made their own selections; their unused cards
  // form the text game's small shared bench. All ten active heroes stay unique.
  for (const role of ['Tank', 'Fighter', 'Mage', 'Marksman']) {
    const hero = drawRoleChampion(game, db, used, role);
    game.allies.push(makeUnit(hero.id, db, LEVELS[0]));
  }
  for (let index = 0; index < 4; index++) {
    const hero = drawOne(game, pool.filter(candidate => !used.has(candidate.id)));
    used.add(hero.id);
    game.heroBench.push(hero);
  }
  return game;
}

/** Exchange one personal hero card with one teammate's abandoned bench card. */
export function swapHeroFromBench(game, benchId, offerId, db) {
  if (game.phase !== 'hero_draft') throw new Error('只能在英雄选择阶段交换备选席');
  const benchIndex = game.heroBench.findIndex(hero => hero.id === benchId);
  const offerIndex = game.heroOffers.findIndex(hero => hero.id === offerId);
  if (benchIndex < 0 || offerIndex < 0) throw new Error('请选择当前个人卡与公共备选席中的英雄');
  if (!byId(db.champions, benchId)) throw new Error('备选英雄不在当前目录');
  const next = clone(game);
  const old = next.heroOffers[offerIndex];
  next.heroOffers[offerIndex] = next.heroBench[benchIndex];
  next.heroBench[benchIndex] = old;
  next.log.push({ kind: 'hero', round: 1, text: `从公共备选席换入「${next.heroOffers[offerIndex].name}」。` });
  return next;
}

export function chooseHero(game, championId, db) {
  if (game.phase !== 'hero_draft') throw new Error('当前不是英雄选择阶段');
  const selected = game.heroOffers.find(hero => hero.id === championId);
  if (!selected || !byId(db.champions, championId)) throw new Error('只能锁定当前两张个人英雄卡之一');
  const next = clone(game);
  next.player = makeUnit(championId, db, LEVELS[0], 3500);
  const used = new Set([championId, ...next.allies.map(unit => unit.championId)]);
  // Some drafts replace the enemy support with a backline-diving assassin.
  const enemyRoles = random(next) < .4 ? [...ROLES.slice(0, 4), 'Assassin'] : ROLES;
  for (const role of enemyRoles) {
    const enemy = drawRoleChampion(next, db, used, role);
    next.enemies.push(makeUnit(enemy.id, db, LEVELS[0]));
  }
  drawAugments(next, db);
  next.phase = 'augment_draft';
  next.log.push({ kind: 'hero', round: 1, text: `锁定「${selected.name}」，匹配到四名队友和五名对手；四次海克斯选择将在开局、7、11、15 级进行。` });
  return next;
}

/** A whole-set one-time reroll is a text-game simplification, not live rules. */
export function rerollAugments(game, db) {
  if (game.phase !== 'augment_draft') throw new Error('只能在海克斯选择阶段刷新');
  if (game.augmentRerollsRemaining <= 0) throw new Error('本次海克斯刷新次数已用完');
  const next = clone(game);
  const seen = new Set([...next.seenAugmentIds, ...next.player.augmentIds]);
  const pool = db.augments.filter(card => card.rarity === next.offerRarity && !seen.has(card.id));
  if (pool.length < 3) throw new Error('当前稀有度的剩余海克斯不足');
  next.augmentOffers = [];
  for (let index = 0; index < 3; index++) {
    const chosen = drawOne(next, pool);
    next.augmentOffers.push(chosen);
    next.seenAugmentIds.push(chosen.id);
  }
  next.augmentRerollsRemaining = 0;
  next.log.push({ kind: 'draft', round: next.round, text: '整组三张海克斯已刷新一次（本站文字游戏改编）。' });
  return next;
}

export function chooseAugment(game, id, db) {
  if (game.phase !== 'augment_draft') throw new Error('当前不是海克斯选择阶段');
  const card = game.augmentOffers.find(offer => offer.id === id);
  if (!card || !byId(db.augments, id)) throw new Error('只能选择当前三张海克斯之一');
  const next = clone(game);
  next.player.augmentIds.push(id);
  const immediateGold = IMMEDIATE_AUGMENT_GOLD[id] || 0;
  next.player.gold += immediateGold;
  next.augmentOffers = [];
  next.phase = 'shop';
  syncUnit(next.player, db, true);
  next.log.push({ kind: 'draft', round: next.round, text: `选择${card.rarity === 'prismatic' ? '棱彩' : card.rarity === 'gold' ? '黄金' : '白银'}海克斯「${card.name}」。` });
  if (immediateGold) next.log.push({ kind: 'economy', round: next.round, text: `「${card.name}」立即提供 ${immediateGold} 金币。` });
  return next;
}

export function buyItem(game, id, db) {
  if (game.phase !== 'shop') throw new Error('只能在备战商店购买装备');
  const item = byId(db.items, id);
  if (!item || item.purchasable === false || !['component', 'starter', 'legendary', 'boots'].includes(item.category) || !((item.shopCost ?? item.gold) > 0)) {
    throw new Error('只能购买目录中的可购装备；消耗品与特殊装备暂未纳入文字对局');
  }
  if (['legendary', 'boots'].includes(item.category) && game.player.itemIds.includes(id)) throw new Error('每种成装只能购买一件');
  // A held direct recipe component is consumed at its catalogue value. Matching
  // uses an array rather than a Set because several recipes need two copies.
  const afterRecipe = [...game.player.itemIds];
  const consumed = [];
  for (const componentId of item.from || []) {
    const index = afterRecipe.indexOf(componentId);
    if (index < 0) continue;
    consumed.push(afterRecipe.splice(index, 1)[0]);
  }
  if (afterRecipe.length >= 6) throw new Error('装备栏已满，请先出售或合成组件');
  if (item.category === 'boots' && afterRecipe.some(owned => byId(db.items, owned)?.category === 'boots')) throw new Error('最多只能持有一双鞋子');
  const discount = consumed.reduce((sum, componentId) => {
    const component = byId(db.items, componentId);
    return sum + (component?.shopCost ?? component?.gold ?? 0);
  }, 0);
  const cost = Math.max(0, (item.shopCost ?? item.gold) - discount);
  if (game.player.gold < cost) throw new Error('金币不足');
  const next = clone(game);
  next.player.gold -= cost;
  next.player.itemIds = [...afterRecipe, id];
  syncUnit(next.player, db, true);
  next.log.push({ kind: 'shop', round: next.round, text: `${consumed.length ? `消耗 ${consumed.map(componentId => byId(db.items, componentId)?.name || componentId).join('、')}，` : ''}花费 ${cost} 金币${consumed.length ? '合成' : '购买'}「${item.name}」。` });
  return next;
}

export function sellItem(game, id, db) {
  if (game.phase !== 'shop') throw new Error('只能在备战商店出售装备');
  const item = byId(db.items, id);
  if (!item || !game.player.itemIds.includes(id)) throw new Error('未持有这件装备');
  const next = clone(game);
  const refund = Math.floor((item.shopCost ?? item.gold) * .7);
  next.player.itemIds.splice(next.player.itemIds.indexOf(id), 1);
  next.player.gold += refund;
  delete next.player.growth[id];
  delete next.player.growth[`evolve:${id}`];
  syncUnit(next.player, db, true);
  next.log.push({ kind: 'shop', round: next.round, text: `出售「${item.name}」，返还 ${refund} 金币。` });
  return next;
}

export function getSynergies(game, db) {
  if (!game.player) return [];
  const champion = byId(db.champions, game.player.championId);
  if (!champion) return [];
  const items = new Set(game.player.itemIds);
  const augments = new Set(game.player.augmentIds);
  return SYNERGY_RULES.filter(rule =>
    (!rule.heroes || rule.heroes.includes(champion.id)) &&
    (!rule.tags || rule.tags.some(tag => champion.tags.includes(tag))) &&
    (!rule.items || rule.items.every(id => items.has(id))) &&
    (!rule.anyItems || rule.anyItems.some(id => items.has(id))) &&
    (!rule.augments || rule.augments.every(id => augments.has(id)))
  ).map(rule => ({
    id: rule.id, title: rule.title, detail: rule.detail,
    bonus: [rule.attack && `输出 +${Math.round(rule.attack * 100)}%`, rule.defense && `承伤 -${Math.round(rule.defense * 100)}%`, rule.steel && `叠钢效率 +${Math.round(rule.steel * 100)}%`].filter(Boolean).join(' · '),
    triggeredBy: [...(rule.heroes || []), ...(rule.tags || []), ...(rule.items || []), ...(rule.anyItems || []), ...(rule.augments || [])],
    attack: rule.attack || 0, defense: rule.defense || 0, steel: rule.steel || 0,
  }));
}

export function startFight(game, db) {
  if (game.phase !== 'shop') throw new Error('选完海克斯并备战后才能开始团战');
  if (!game.player || !byId(db.champions, game.player.championId)) throw new Error('尚未选择英雄');
  const next = clone(game);
  for (const unit of next.allies) botGear(unit, 'ally', next, db);
  for (const unit of next.enemies) botGear(unit, 'enemy', next, db);
  next.phase = 'target';
  next.tacticStage = null;
  next.priorityTargetId = null;
  next.pendingTactics = [];
  next.log.push({ kind: 'combat', round: next.round, text: `第 ${next.round} 场团战开始：先确定集火目标，再选择开团、交战与收尾策略。` });
  return next;
}

export function choosePriorityTarget(game, championId, db) {
  if (game.phase !== 'target') throw new Error('当前不是集火目标选择阶段');
  const enemy = game.enemies.find(unit => unit.championId === championId);
  const champion = byId(db.champions, championId);
  if (!enemy || !champion) throw new Error('只能标记本场的一名敌方英雄');
  const next = clone(game);
  next.priorityTargetId = championId;
  next.phase = 'tactic';
  next.tacticStage = STAGES[0];
  next.log.push({ kind: 'decision', round: next.round, text: `全队标记「${champion.name}」为优先集火目标。` });
  return next;
}

const backline = champion => champion.tags.some(tag => ['Mage', 'Marksman', 'Support'].includes(tag));
const frontline = champion => champion.tags.some(tag => ['Tank', 'Fighter'].includes(tag));

function botGear(unit, side, game, db) {
  const champion = byId(db.champions, unit.championId);
  const role = roleOf(champion);
  const plan = BOT_ITEMS[role] || BOT_ITEMS.Fighter;
  const extra = Math.floor(game.sideEconomy[side] / 2600);
  const count = clamp(game.round + extra, 0, 4);
  for (const id of plan.slice(0, count)) {
    if (byId(db.items, id) && !unit.itemIds.includes(id)) unit.itemIds.push(id);
  }
  if (side === 'enemy') {
    for (const id of BOT_AUGMENTS[role].slice(0, game.round)) {
      if (byId(db.augments, id) && !unit.augmentIds.includes(id)) unit.augmentIds.push(id);
    }
  }
  syncUnit(unit, db, true);
}

function proxyAugments(game, db) {
  const modeled = new Set(['draw_your_sword', 'blunt_force', 'witchful_thinking', 'goliath', 'celestial_body', 'deft', 'recursion', 'infinite_recursion', 'phenomenal_evil']);
  let attack = 0, defense = 0, sustain = 0;
  for (const id of game.player.augmentIds) {
    if (modeled.has(id)) continue;
    const card = byId(db.augments, id);
    if (!card) continue;
    const text = `${card.name} ${card.effect || ''}`;
    const magnitude = card.rarity === 'prismatic' ? .035 : card.rarity === 'gold' ? .025 : .015;
    if (/护盾|治疗|生命|护甲|魔抗/.test(text)) defense += magnitude;
    else if (/回复|吸血/.test(text)) sustain += magnitude;
    else attack += magnitude;
  }
  return { attack: clamp(attack, 0, .12), defense: clamp(defense, 0, .12), sustain: clamp(sustain, 0, .10) };
}

function tacticEffects(game, db) {
  const chosen = Object.fromEntries(game.pendingTactics.map(choice => [choice.stage, choice.id]));
  const synergies = getSynergies(game, db);
  const proxy = proxyAugments(game, db);
  const hero = byId(db.champions, game.player.championId);
  const ranged = hero.stats.attackrange >= 400;
  const effects = {
    attack: 1 + proxy.attack + clamp(synergies.reduce((sum, rule) => sum + rule.attack, 0), 0, .25),
    defense: 1 + proxy.defense + clamp(synergies.reduce((sum, rule) => sum + rule.defense, 0), 0, .20),
    sustain: proxy.sustain, teamAttack: clamp(1 + (game.mapControl || 0) * .035, .86, 1.14),
    teamDefense: clamp(1 + (game.mapControl || 0) * .018, .92, 1.08),
    backline: 1, frontline: 1, steel: 1 + clamp(synergies.reduce((sum, rule) => sum + rule.steel, 0), 0, .7),
    target: 'normal', extraRisk: 1, openingAttack: 1, focusDamage: 1, siege: 1,
  };
  if (['Nasus', 'Veigar'].includes(hero.id) && game.player.augmentIds.includes('stackosaurusrex')) {
    effects.attack += Math.min(.08, (game.player.growth.stackosaurusrex || 0) * .012);
  }
  switch (chosen.engage) {
    case 'backline': effects.target = 'backline'; effects.backline *= 1.18; effects.extraRisk *= 1.10; break;
    case 'frontline': effects.target = 'frontline'; effects.frontline *= 1.12; effects.defense *= 1.04; break;
    case 'flank': effects.target = 'backline'; effects.backline *= 1.11; effects.teamAttack *= 1.05; effects.teamDefense *= .94; break;
    case 'guard': effects.target = 'assassin'; effects.attack *= .96; effects.teamAttack *= .97; effects.teamDefense *= game.enemies.some(unit => byId(db.champions, unit.championId)?.tags.includes('Assassin')) ? 1.08 : 1.02; break;
    case 'steel': effects.target = 'frontline'; effects.attack *= .96; effects.steel *= 1.38; break;
    case 'ambush': effects.openingAttack *= 1.27; effects.extraRisk *= 1.09; break;
    case 'poke': effects.openingAttack *= ranged ? 1.22 : .88; effects.target = 'backline'; break;
    case 'press': effects.teamAttack *= 1.08; effects.teamDefense *= .94; break;
  }
  switch (chosen.response) {
    case 'burst': effects.attack *= 1.15; effects.extraRisk *= 1.07; break;
    case 'kite': effects.attack *= ranged ? 1.03 : .91; effects.defense *= 1.10; break;
    case 'peel': effects.attack *= .94; effects.teamAttack *= .96; effects.teamDefense *= 1.04; break;
    case 'sustain': effects.attack *= .97; effects.sustain += .07; effects.defense *= 1.04; break;
    case 'steel': effects.attack *= .98; effects.steel *= 1.34; effects.extraRisk *= 1.04; break;
    case 'interrupt': effects.teamDefense *= game.enemies.some(unit => byId(db.champions, unit.championId)?.tags.some(tag => ['Assassin', 'Mage'].includes(tag))) ? 1.08 : 1.025; effects.attack *= .97; break;
    case 'all_in': effects.attack *= 1.20; effects.extraRisk *= 1.16; break;
    case 'bait': effects.teamAttack *= game.enemies.some(unit => byId(db.champions, unit.championId)?.tags.includes('Assassin')) ? 1.10 : 1.035; effects.teamDefense *= .96; break;
  }
  switch (chosen.finish) {
    case 'chase': effects.attack *= 1.12; effects.extraRisk *= 1.10; break;
    case 'secure': effects.attack *= .98; effects.teamAttack *= 1.08; break;
    case 'disengage': effects.attack *= .85; effects.teamAttack *= .88; effects.teamDefense *= 1.04; effects.defense *= 1.07; break;
    case 'counter': effects.attack *= game.enemies.some(unit => byId(db.champions, unit.championId)?.tags.includes('Assassin')) ? 1.08 : 1.01; effects.teamDefense *= 1.02; effects.target = 'assassin'; break;
    case 'steel': effects.attack *= .94; effects.steel *= 1.30; break;
    case 'execute': effects.focusDamage *= 1.18; effects.teamDefense *= .94; break;
    case 'escort': effects.attack *= .84; effects.teamAttack *= .88; effects.teamDefense *= 1.09; break;
    case 'siege_ready': effects.attack *= .92; effects.siege *= 1.3; break;
  }
  return effects;
}

function chooseTarget(game, attacker, defenders, isPlayer, effects, friendly) {
  let best = null, bestScore = -Infinity;
  for (let index = 0; index < defenders.length; index++) {
    const target = defenders[index];
    if (target.hp <= 0) continue;
    let score = (1 - target.hp / target.maxHp) * 2;
    if (attacker.champion.tags.includes('Assassin') && backline(target.champion)) score += 1.15;
    else if (frontline(target.champion)) score += .55;
    if (isPlayer) {
      if (effects.target === 'backline' && backline(target.champion)) score += 2.8;
      if (effects.target === 'frontline' && frontline(target.champion)) score += 2.8;
      if (effects.target === 'assassin' && target.champion.tags.includes('Assassin')) score += 3;
    }
    if (friendly && target.champion.id === game.priorityTargetId) score += isPlayer ? 4.2 : 1.75;
    score += random(game) * .2;
    if (score > bestScore) { bestScore = score; best = index; }
  }
  return best;
}

function simulateBattle(game, db) {
  const effects = tacticEffects(game, db);
  const allies = [game.player, ...game.allies].map(unit => {
    const champion = byId(db.champions, unit.championId);
    const panel = panelFor(unit, db);
    return { champion, panel, hp: panel.stats.hp, maxHp: panel.stats.hp, damage: 0, kills: 0 };
  });
  const enemies = game.enemies.map(unit => {
    const champion = byId(db.champions, unit.championId);
    const panel = panelFor(unit, db);
    const combat = unit.augmentIds.reduce((total, id) => {
      const effect = BOT_AUGMENT_COMBAT[id];
      if (effect) for (const key of ['attack', 'defense', 'healing', 'receivedHealing', 'giantDamage']) total[key] += effect[key] || 0;
      return total;
    }, { attack: 0, defense: 0, healing: 0, receivedHealing: 0, giantDamage: 0 });
    return { champion, panel, combat, hp: panel.stats.hp, maxHp: panel.stats.hp, damage: 0, kills: 0 };
  });
  let steelHits = 0;
  let elapsed = 0;
  const events = [];
  for (let tick = 0; tick < 72; tick++) {
    if (!allies.some(unit => unit.hp > 0) || !enemies.some(unit => unit.hp > 0)) break;
    const hitAllies = Array(5).fill(0), hitEnemies = Array(5).fill(0);
    const killerAllies = Array(5).fill(null), killerEnemies = Array(5).fill(null);
    const attackSide = (attackers, defenders, pending, killers, friendly) => {
      for (let index = 0; index < attackers.length; index++) {
        const attacker = attackers[index];
        if (attacker.hp <= 0) continue;
        const playerAttack = friendly && index === 0;
        const targetIndex = chooseTarget(game, attacker, defenders, playerAttack, effects, friendly);
        if (targetIndex === null) continue;
        const target = defenders[targetIndex];
        let hit = damageProfile(attacker, target).total * .5 * (.94 + random(game) * .12);
        if (playerAttack) {
          hit *= effects.attack;
          if (tick < 8) hit *= effects.openingAttack;
          if (backline(target.champion)) hit *= effects.backline;
          if (frontline(target.champion)) hit *= effects.frontline;
          if (game.player.itemIds.includes('3084') && frontline(target.champion) && tick % 5 === 0 && steelHits < 6) {
            steelHits += Math.max(1, Math.round(effects.steel));
          }
        } else if (friendly) hit *= effects.teamAttack * (tick < 8 ? 1 + (effects.openingAttack - 1) * .4 : 1);
        else {
          const giantFactor = target.maxHp >= attacker.maxHp * 1.15 || target.champion.tags.includes('Tank') ? 1 : .3;
          hit *= 1 + (attacker.combat?.attack || 0) + (attacker.combat?.giantDamage || 0) * giantFactor;
          if (targetIndex === 0) hit *= effects.extraRisk / effects.defense;
          else hit /= effects.teamDefense;
        }
        if (friendly) hit /= 1 + (target.combat?.defense || 0);
        if (friendly && target.champion.id === game.priorityTargetId) hit *= playerAttack ? effects.focusDamage * 1.06 : 1 + (effects.focusDamage - 1) * .5;
        pending[targetIndex] += hit;
        attacker.damage += hit;
        if (!killers[targetIndex] || hit > killers[targetIndex].hit) killers[targetIndex] = { index, hit };
      }
    };
    attackSide(allies, enemies, hitEnemies, killerEnemies, true);
    attackSide(enemies, allies, hitAllies, killerAllies, false);
    const settle = (defenders, pending, killers, attackers, friendly) => {
      for (let index = 0; index < defenders.length; index++) {
        const target = defenders[index];
        if (target.hp <= 0) continue;
        const before = target.hp;
        target.hp -= pending[index];
        if (before > 0 && target.hp <= 0) {
          if (killers[index]) attackers[killers[index].index].kills++;
          if (events.length < 7) events.push(`${friendly ? '我方' : '敌方'}击倒${target.champion.name}`);
        }
      }
    };
    settle(enemies, hitEnemies, killerEnemies, allies, true);
    settle(allies, hitAllies, killerAllies, enemies, false);
    if (allies[0].hp > 0 && effects.sustain) allies[0].hp = Math.min(allies[0].maxHp, allies[0].hp + allies[0].maxHp * effects.sustain * .008);
    for (const [team, friendly] of [[allies, true], [enemies, false]]) {
      const living = team.filter(unit => unit.hp > 0);
      const support = living.find(unit => unit.champion.tags.includes('Support'));
      if (!support || !living.length) continue;
      const patient = living.reduce((a, b) => a.hp / a.maxHp < b.hp / b.maxHp ? a : b);
      const healing = (20 + support.panel.stats.ap * .06) * (friendly ? effects.teamDefense : 1 + (support.combat?.healing || 0));
      patient.hp = Math.min(patient.maxHp, patient.hp + healing * (1 + (patient.combat?.receivedHealing || 0)));
    }
    elapsed += .5;
  }
  const allyAlive = allies.filter(unit => unit.hp > 0);
  const enemyAlive = enemies.filter(unit => unit.hp > 0);
  const allyFraction = allies.reduce((sum, unit) => sum + Math.max(0, unit.hp) / unit.maxHp, 0);
  const enemyFraction = enemies.reduce((sum, unit) => sum + Math.max(0, unit.hp) / unit.maxHp, 0);
  const winner = !enemyAlive.length && !allyAlive.length ?
    (allies.reduce((sum, unit) => sum + unit.kills, 0) >= enemies.reduce((sum, unit) => sum + unit.kills, 0) ? 'ally' : 'enemy')
    : !enemyAlive.length ? 'ally' : !allyAlive.length ? 'enemy'
    : allyFraction >= enemyFraction ? 'ally' : 'enemy';
  const allyKills = allies.reduce((sum, unit) => sum + unit.kills, 0);
  const enemyKills = enemies.reduce((sum, unit) => sum + unit.kills, 0);
  const playerKills = allies[0].kills;
  const playerAssists = allies[0].damage > 0 ? Math.min(5, Math.max(0, allyKills - playerKills)) : 0;
  const income = {
    base: 1500, winBonus: winner === 'ally' ? 1050 : 350,
    killBonus: playerKills * 250, assistBonus: playerAssists * 120,
  };
  const nextStreak = winner === 'ally' ? (game.winStreak?.ally || 0) + 1 : 0;
  income.streakBonus = winner === 'ally' ? Math.min(900, Math.max(0, nextStreak - 1) * 300) : 0;
  income.objectiveBonus = 0;
  income.total = income.base + income.winBonus + income.killBonus + income.assistBonus + income.streakBonus;
  const tacticImpact = {
    playerAttackFactor: Number(effects.attack.toFixed(2)),
    playerDamageTakenFactor: Number((effects.extraRisk / effects.defense).toFixed(2)),
    teamAttackFactor: Number(effects.teamAttack.toFixed(2)),
    teamDamageTakenFactor: Number((1 / effects.teamDefense).toFixed(2)),
    steelFactor: Number(effects.steel.toFixed(2)),
    siegeFactor: Number(effects.siege.toFixed(2)),
  };
  const focusUnit = enemies.find(unit => unit.champion.id === game.priorityTargetId);
  const focusTarget = focusUnit ? {
    championId: focusUnit.champion.id, name: focusUnit.champion.name,
    killed: focusUnit.hp <= 0, remainingHp: Math.max(0, Math.round(focusUnit.hp)),
  } : null;
  events.unshift(`本站战术推演：集火${focusTarget?.name || '敌方'}，${game.pendingTactics.map(choice => choice.name).join(' → ')}；基础个人输出系数 ×${tacticImpact.playerAttackFactor}，队友承伤系数 ×${tacticImpact.teamDamageTakenFactor}。`);
  return {
    round: game.round, winner, seconds: elapsed,
    tactics: [...game.pendingTactics], playerDamage: Math.round(allies[0].damage),
    playerKills, playerAssists, playerDeaths: allies[0].hp <= 0 ? 1 : 0,
    allyKills, enemyKills, steelHits: Math.min(8, steelHits),
    economy: income, tacticImpact, events, focusTarget,
    remaining: { ally: allyAlive.length, enemy: enemyAlive.length, playerHp: Math.max(0, Math.round(allies[0].hp)) },
    allyHp: allies.map(unit => Math.max(0, Math.round(unit.hp))),
    enemyHp: enemies.map(unit => Math.max(0, Math.round(unit.hp))),
    allyUnitKills: allies.map(unit => unit.kills),
    enemyUnitKills: enemies.map(unit => unit.kills),
    synergies: getSynergies(game, db),
  };
}

function applyGrowth(game, round, db) {
  const growthEvents = [];
  if (game.player.itemIds.includes('3084') && round.steelHits > 0) {
    const quest = game.player.augmentIds.includes('quest_steel_your_heart');
    const added = round.steelHits * 30 * (quest ? 3 : 1);
    game.player.growth['3084'] = (game.player.growth['3084'] || 0) + added;
    round.heartsteelHealthGained = added;
    growthEvents.push(`心之钢有效触发 ${round.steelHits} 次，永久生命值 +${added}`);
  } else round.heartsteelHealthGained = 0;
  if (game.player.augmentIds.includes('phenomenal_evil')) {
    const stacks = clamp(Math.round(round.playerDamage / 450), 2, 12);
    game.player.growth.phenomenal_evil = (game.player.growth.phenomenal_evil || 0) + stacks;
    growthEvents.push(`超凡邪恶成长 ${stacks} 层`);
  }
  if (game.player.augmentIds.includes('infinite_recursion')) {
    const participations = Math.min(5, round.allyKills);
    game.player.growth.infinite_recursion = (game.player.growth.infinite_recursion || 0) + participations;
    growthEvents.push(`无限循环往复按团队击倒估算参与击杀 ${participations} 次`);
  }
  if (game.player.itemIds.includes('126697') && round.playerKills) {
    const added = round.playerKills * 2;
    game.player.growth['126697'] = (game.player.growth['126697'] || 0) + added;
    growthEvents.push(`狂妄永久攻击力 +${added}`);
  }
  if (game.player.itemIds.includes('6657')) {
    const stacks = Math.min(10, (game.player.growth['6657'] || 0) + 3);
    game.player.growth['6657'] = stacks;
    growthEvents.push(`时光之杖推进至 ${stacks} 层`);
  }
  if (game.player.augmentIds.includes('stackosaurusrex') && ['Nasus', 'Veigar'].includes(game.player.championId)) {
    const added = clamp(round.playerKills + 1, 1, 5);
    game.player.growth.stackosaurusrex = (game.player.growth.stackosaurusrex || 0) + added;
    growthEvents.push(`叠角龙与英雄成长路线推进 ${added} 层`);
  }
  for (const evolved of db.items.filter(item => item.category === 'evolved' && item.evolvesFrom)) {
    const baseId = evolved.evolvesFrom;
    const index = game.player.itemIds.indexOf(baseId);
    if (index < 0) continue;
    const progressKey = `evolve:${baseId}`;
    const progress = (game.player.growth[progressKey] || 0) + 1;
    if (progress >= 2) {
      game.player.itemIds[index] = evolved.id;
      delete game.player.growth[progressKey];
      growthEvents.push(`${byId(db.items, baseId)?.name || baseId}进化为${evolved.name}`);
    } else {
      game.player.growth[progressKey] = progress;
      growthEvents.push(`${byId(db.items, baseId)?.name || baseId}进化进度 ${progress}/2`);
    }
  }
  round.growthEvents = growthEvents;
  for (const entry of growthEvents) game.log.push({ kind: 'growth', round: game.round, text: `${entry}（本站文字游戏抽象）。` });
  syncUnit(game.player, db, false);
}

function resolveFight(game, db) {
  for (const unit of game.allies) botGear(unit, 'ally', game, db);
  for (const unit of game.enemies) botGear(unit, 'enemy', game, db);
  syncUnit(game.player, db, true);
  const round = simulateBattle(game, db);
  game.lastRound = round;
  game.rounds.push(round);
  game.score[round.winner]++;
  game.winStreak ||= { ally: 0, enemy: 0 };
  game.winStreak[round.winner]++;
  game.winStreak[round.winner === 'ally' ? 'enemy' : 'ally'] = 0;
  game.player.kills += round.playerKills;
  game.player.assists += round.playerAssists;
  game.player.deaths += round.playerDeaths;
  game.player.hp = round.remaining.playerHp;
  game.allies.forEach((unit, index) => {
    unit.hp = round.allyHp[index + 1];
    unit.kills += round.allyUnitKills[index + 1];
    if (unit.hp <= 0) unit.deaths++;
  });
  game.enemies.forEach((unit, index) => {
    unit.hp = round.enemyHp[index];
    unit.kills += round.enemyUnitKills[index];
    if (unit.hp <= 0) unit.deaths++;
  });
  applyGrowth(game, round, db);
  game.player.gold += round.economy.total;
  game.sideEconomy.ally += 1300;
  game.sideEconomy.enemy += 1300;
  game.sideEconomy[round.winner] += 900 + (round.winner === 'ally' ? round.allyKills : round.enemyKills) * 100 + Math.max(0, game.winStreak[round.winner] - 1) * 180;
  game.log.push({ kind: 'combat', round: game.round, text: `第 ${game.round} 场${round.winner === 'ally' ? '我方获胜' : '敌方获胜'}；你击倒 ${round.playerKills} 人、助攻 ${round.playerAssists} 次。` });
  game.log.push({ kind: 'economy', round: game.round, text: `团战收入 ${round.economy.total} 金币：基础 ${round.economy.base} + ${round.winner === 'ally' ? '胜利' : '失利'} ${round.economy.winBonus} + 击杀 ${round.economy.killBonus} + 助攻 ${round.economy.assistBonus} + 连胜 ${round.economy.streakBonus}。` });
  for (const event of round.events.slice(0, 5)) game.log.push({ kind: 'event', round: game.round, text: event });
  game.phase = 'objective';
  game.tacticStage = null;
}

function finishResult(game) {
  const destroyedEnemy = game.towers.enemy <= 0;
  const destroyedAlly = game.towers.ally <= 0;
  const stoleBase = game.lastRound?.objective?.id === 'backdoor' && game.lastRound.objective.backdoorSuccess;
  const allyPoints = game.score.ally * 25 + (100 - game.towers.enemy) * .8 + game.mapControl * 3;
  const enemyPoints = game.score.enemy * 25 + (100 - game.towers.ally) * .8 - game.mapControl * 3;
  const killDifference = game.rounds.reduce((sum, round) => sum + round.allyKills - round.enemyKills, 0);
  const winner = stoleBase ? 'ally' : destroyedEnemy !== destroyedAlly ? (destroyedEnemy ? 'ally' : 'enemy')
    : allyPoints !== enemyPoints ? (allyPoints > enemyPoints ? 'ally' : 'enemy')
    : killDifference >= 0 ? 'ally' : 'enemy';
  const reason = stoleBase ? '最后一波偷塔成功，终局直接获胜。'
    : destroyedEnemy !== destroyedAlly ? '防御塔被摧毁，推进结果直接决定胜负。'
    : '按团战胜场、推塔进度与地图控制综合判定；同分时比较击倒数。';
  game.result = {
    winner, score: { ...game.score }, towers: { ...game.towers }, mapControl: game.mapControl,
    objectivePoints: { ally: Number(allyPoints.toFixed(1)), enemy: Number(enemyPoints.toFixed(1)) },
    playerKills: game.player.kills, playerDeaths: game.player.deaths,
    playerAssists: game.player.assists, reason,
  };
}

/** Choose what the team does with the space won or lost after each fight. */
export function chooseObjective(game, id, db) {
  if (game.phase !== 'objective' || !game.lastRound) throw new Error('只能在团战后选择战略目标');
  const option = getObjectiveOptions(game).find(entry => entry.id === id);
  if (!option) throw new Error('请选择当前可用的战略目标');
  const next = clone(game);
  next.towers ||= { ally: 100, enemy: 100 };
  next.mapControl ||= 0;
  next.winStreak ||= { ally: 0, enemy: 0 };
  const round = next.lastRound;
  const won = round.winner === 'ally';
  const basePressure = won ? 3 + round.remaining.enemy * 2 : 14 + round.remaining.enemy * 3;
  const oldEnemyTower = next.towers.enemy;
  const oldAllyTower = next.towers.ally;
  const oldControl = next.mapControl;
  let enemyDamage = 0;
  let ownDamage = basePressure;
  let gold = 0;
  let backdoorChance = null;
  let backdoorSuccess = null;
  let text;
  switch (id) {
    case 'push_tower':
      enemyDamage = won ? Math.round((18 + round.remaining.ally * 4 + (round.focusTarget?.killed ? 2 : 0)) * (round.tacticImpact.siegeFactor || 1) * (1 + Math.max(0, next.mapControl) * .03))
        : 3 + round.remaining.ally * 3;
      ownDamage += won ? 0 : 7;
      gold = won ? 700 + Math.min(250, enemyDamage * 7) : 150;
      text = won ? '赢下团战后推进兵线，拆掉敌塔一段耐久并拿到塔钱。' : '团战失利后仍尝试强推，推进有限且暴露了己方防线。';
      break;
    case 'farm_wave':
      gold = won ? 1350 : 1000;
      ownDamage = Math.round(basePressure * (won ? 1 : 1.08));
      text = '回收兵线资源，为下一轮海克斯与装备积攒金币。';
      break;
    case 'take_camps':
      gold = won ? 900 : 400;
      next.mapControl = clamp(next.mapControl + (won ? 1 : -1), -4, 4);
      ownDamage += won ? 1 : 4;
      text = won ? '拿下回血包并控制关键位置，下一轮团战获得阵地优势。' : '补给争夺受阻，失去一部分地图控制。';
      break;
    case 'defend_tower':
      gold = won ? 400 : 550;
      ownDamage = Math.round(basePressure * .22);
      text = '回防并清理兵线，显著减少敌方推进。';
      break;
    case 'backdoor': {
      const gear = next.player.itemIds.filter(itemId => byId(db.items, itemId)?.category !== 'component').length;
      const profile = panelFor(next.player, db);
      const mobility = profile.stats.as > 1.25 ? .04 : 0;
      backdoorChance = clamp(.08 + (100 - next.towers.enemy) * .0035 + round.remaining.ally * .045
        - round.remaining.enemy * .035 + gear * .025 + (won ? .12 : 0)
        + next.mapControl * .025 + mobility - (round.playerDeaths ? .12 : 0), .01, .86);
      backdoorChance = Number(backdoorChance.toFixed(2));
      backdoorSuccess = random(next) < backdoorChance;
      if (backdoorSuccess) {
        enemyDamage = next.towers.enemy;
        gold = 900;
        text = `偷塔成功！你绕开正面防线，击穿敌塔（推演成功率 ${Math.round(backdoorChance * 100)}%）。`;
      } else {
        ownDamage += 18;
        text = `偷塔失败，敌方趁机反推（推演成功率 ${Math.round(backdoorChance * 100)}%）。`;
      }
      break;
    }
  }
  next.towers.enemy = clamp(oldEnemyTower - enemyDamage, 0, 100);
  next.towers.ally = clamp(oldAllyTower - ownDamage, 0, 100);
  const towerDamage = oldEnemyTower - next.towers.enemy;
  const ownTowerDamage = oldAllyTower - next.towers.ally;
  const mapControlDelta = next.mapControl - oldControl;
  const objective = { id, name: option.name, text, gold, towerDamage, ownTowerDamage,
    mapControlDelta, backdoorChance, backdoorSuccess };
  round.objective = objective;
  round.economy.objectiveBonus = gold;
  round.economy.total += gold;
  next.rounds[next.rounds.length - 1] = clone(round);
  next.player.gold += gold;
  next.sideEconomy.ally += won ? Math.round(gold * .35) : 0;
  next.log.push({ kind: 'objective', round: next.round, text: `${option.name}：${text}敌塔 -${towerDamage}，我塔 -${ownTowerDamage}，金币 +${gold}${mapControlDelta ? `，地图控制 ${mapControlDelta > 0 ? '+' : ''}${mapControlDelta}` : ''}。` });
  next.log.push({ kind: 'economy', round: next.round, text: `本轮总收入 ${round.economy.total} 金币，其中团战 ${round.economy.total - gold}、战略行动 ${gold}。` });
  next.phase = 'report';
  if (next.round === next.maxRounds) finishResult(next);
  return next;
}

export function chooseTactic(game, id, db) {
  if (game.phase !== 'tactic' || !STAGES.includes(game.tacticStage)) throw new Error('当前不是团战决策阶段');
  const option = TACTIC_OPTIONS[game.tacticStage].find(choice => choice.id === id);
  if (!option) throw new Error('请选择当前阶段提供的团战策略');
  const next = clone(game);
  next.pendingTactics.push({ stage: next.tacticStage, id, name: option.name });
  next.log.push({ kind: 'decision', round: next.round, text: `${next.tacticStage === 'engage' ? '开团' : next.tacticStage === 'response' ? '交战' : '收尾'}：${option.name}。` });
  const index = STAGES.indexOf(next.tacticStage);
  if (index < STAGES.length - 1) next.tacticStage = STAGES[index + 1];
  else resolveFight(next, db);
  return next;
}

export function advanceRound(game, db) {
  if (game.phase !== 'report' || !game.lastRound?.objective) throw new Error('请先完成本轮战略目标并查看战报');
  const next = clone(game);
  if (next.round >= next.maxRounds) {
    next.phase = 'finished';
    next.log.push({ kind: 'result', round: next.round, text: `整场结束：${next.result.winner === 'ally' ? '我方获胜' : '敌方获胜'}，团战 ${next.score.ally}:${next.score.enemy}，敌塔剩余 ${next.towers.enemy}、我塔剩余 ${next.towers.ally}。` });
    return next;
  }
  next.round++;
  next.phase = 'augment_draft';
  next.pendingTactics = [];
  next.priorityTargetId = null;
  next.player.level = LEVELS[next.round - 1];
  syncUnit(next.player, db, true);
  for (const unit of [...next.allies, ...next.enemies]) {
    unit.level = LEVELS[next.round - 1];
    syncUnit(unit, db, true);
  }
  drawAugments(next, db);
  next.log.push({ kind: 'system', round: next.round, text: `升至 ${next.player.level} 级，开始新一轮海克斯选择。团战经济已计入商店金币。` });
  return next;
}
