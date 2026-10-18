import './standalone.css';
import { computeBuild } from './model.js';
import {
  createStandaloneGame, swapHeroFromBench, chooseHero,
  rerollAugments, chooseAugment, buyItem, sellItem,
  startFight, choosePriorityTarget, chooseTactic, chooseObjective,
  advanceRound, getSynergies, getObjectiveOptions, TACTIC_OPTIONS,
} from './standalone-engine.js';

const SAVE_KEY = 'mayhem-standalone-v2';
const root = document.querySelector('#game-root');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const number = value => Math.round(Number(value) || 0).toLocaleString('zh-CN');
const roleName = role => ({ Tank: '坦克', Fighter: '战士', Mage: '法师', Marksman: '射手', Assassin: '刺客', Support: '辅助' })[role] || role;
const rarityName = rarity => ({ silver: '白银', gold: '黄金', prismatic: '棱彩' })[rarity] || '强化';
const categoryName = category => ({ legendary: '成装', boots: '鞋子', component: '组件', starter: '出门装', consumable: '消耗品' })[category] || category;
const phaseNames = { hero_draft: '随机英雄卡', augment_draft: '海克斯抉择', shop: '装备商店', target: '集火目标', tactic: '团战指挥', objective: '战后决策', report: '团战战报', finished: '对局结算' };
const tacticStageNames = { engage: '开团目标', response: '临场应对', finish: '收尾抉择' };

let db;
let game = null;
let ui = { focusHero: null, itemFilter: 'all', search: '', error: '', resetArmed: false };

function lookup(type, id) {
  return db[type].find(entry => String(entry.id) === String(id));
}
function cardId(card) {
  return typeof card === 'string' ? card : card?.id ?? card?.championId ?? card?.augmentId;
}
function hero(card) { return lookup('champions', cardId(card)); }
function augment(card) { return lookup('augments', cardId(card)); }
function image(src, label, className = '') {
  return `<span class="art-icon ${className}" aria-hidden="true"><span>✦</span>${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy">` : ''}</span>`;
}
function safeEffect(card) {
  const value = String(card?.effect || '').trim();
  return value && !/@[^@]+@|(?:^|\D)0\s*秒/.test(value)
    ? value : '部分数值会随对局变化；请按下方联动和战报观察本站模拟效果。';
}
function save() {
  try {
    if (game) localStorage.setItem(SAVE_KEY, JSON.stringify({ patch: db.meta.patch, game }));
    else localStorage.removeItem(SAVE_KEY);
  } catch { /* The game still works when browser storage is unavailable. */ }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (saved?.patch === db.meta.patch && phaseNames[saved?.game?.phase] && saved.game.seed != null) game = saved.game;
  } catch { game = null; }
}
function progress() {
  const current = game?.phase === 'target' ? 'tactic' : game?.phase === 'objective' ? 'report' : game?.phase || 'home';
  const steps = [
    ['hero_draft', '英雄卡'], ['augment_draft', '海克斯'], ['shop', '备战'],
    ['tactic', '团战'], ['report', '战后'], ['finished', '终局'],
  ];
  const active = steps.findIndex(([id]) => id === current);
  return `<div class="run-progress" aria-label="游戏阶段">${steps.map(([id, label], index) => `<div class="${index === active ? 'active' : index < active ? 'done' : ''}"><b>${String(index + 1).padStart(2, '0')}</b><span>${label}</span></div>`).join('')}</div>`;
}
function topbar() {
  return `<header class="game-header"><a class="game-brand" href="${import.meta.env.BASE_URL}"><i>M<span>✦</span></i><span><b>海斗战记</b><small>MAYHEM CHRONICLES</small></span></a><div class="game-header-right"><span class="patch-pill">● PATCH ${escapeHtml(db.meta.patch)}</span><a class="builder-link" href="https://xiaokai2810.github.io/haidou-lunzhan/">构筑实验室 ↗</a>${game ? `<button class="reset-button ${ui.resetArmed ? 'armed' : ''}" data-action="reset">${ui.resetArmed ? '确认重开？' : '重新匹配'}</button>` : ''}</div></header>`;
}
function intro() {
  const splash = lookup('champions', 'Yasuo')?.splash || '';
  return `<section class="game-intro" style="--cover:url('${escapeHtml(splash)}')"><div class="intro-copy"><span class="tiny-label">AN INTERACTIVE 5V5 MAYHEM STORY</span><h1>一局海斗，<br><em>由你改写。</em></h1><p>从随机英雄卡开始，逐轮选择海克斯、经营装备与金币。点名集火目标、执行团战战术，再决定推塔、控线或偷塔。</p><div class="intro-cta"><button class="major-button" data-action="start">开始随机匹配 <span>↗</span></button><span>4 轮团战 · 逐轮推进防御塔 · 单机可续玩</span></div></div><div class="intro-strip"><span><b>01</b> 随机英雄与队伍备选席</span><span><b>02</b> 三选一强化与装备合成</span><span><b>03</b> 团战胜负决定地图和经济</span></div></section><section class="intro-below"><article><span>英雄卡</span><h3>两张随机牌，先定你的角色</h3><p>未选英雄进入队伍备选席，可先换牌再锁定。英雄池随机抽样为本站规则。</p></article><article><span>构筑联动</span><h3>英雄、海克斯、装备互相成就</h3><p>战斗中列出触发的组合与来源，让每条路线有可追溯的影响。</p></article><article><span>战术博弈</span><h3>目标、交战与战后推进都由你选</h3><p>击杀、团战胜负、推塔和控线会改变下一轮的商店与战场。</p></article></section>`;
}
function heroDraft() {
  const offers = (game.heroOffers || []).map(hero).filter(Boolean);
  const bench = (game.heroBench || []).map(hero).filter(Boolean);
  if (!ui.focusHero || !offers.some(entry => entry.id === ui.focusHero)) ui.focusHero = offers[0]?.id;
  return `<div class="stage-heading"><div><span class="tiny-label">LOBBY / CHAMPION CARDS</span><h1>命运给你两张英雄卡</h1><p>先选一张个人卡；也可从队伍公共备选席换入英雄，再锁定出战。这里没有旧式英雄重随机。</p></div><span class="stage-count">2 张起手卡</span></div><div class="hero-choice-grid">${offers.map(champion => `<article class="hero-choice ${ui.focusHero === champion.id ? 'selected' : ''}" style="--hero-art:url('${escapeHtml(champion.splash)}')"><button class="hero-focus" data-action="focus-hero" data-id="${escapeHtml(champion.id)}" aria-pressed="${ui.focusHero === champion.id}"><span class="hero-choice-tag">${champion.tags.map(roleName).join(' / ')}</span><span class="hero-choice-title"><small>CHAMPION CARD</small><strong>${escapeHtml(champion.name)}</strong><em>${escapeHtml(champion.title)}</em></span></button><button class="hero-lock" data-action="choose-hero" data-id="${escapeHtml(champion.id)}">锁定 ${escapeHtml(champion.name)} <span>↗</span></button></article>`).join('')}</div><div class="bench-panel"><div class="bench-heading"><div><span class="tiny-label">SHARED BENCH / TEAM OPTIONS</span><h2>队伍备选席</h2><p>先点亮上方要替换的个人卡，再从备选席换入。四张备选卡模拟队友放出的英雄。</p></div><span>换入不消耗金币</span></div><div class="bench-list">${bench.map(champion => `<button class="bench-card" data-action="swap-hero" data-id="${escapeHtml(champion.id)}">${image(champion.icon, champion.name)}<span><b>${escapeHtml(champion.name)}</b><small>${champion.tags.map(roleName).join(' / ')}</small></span><em>换入 ↗</em></button>`).join('')}</div></div>`;
}
function augmentLibrary() {
  const groups = [['silver', '白银'], ['gold', '黄金'], ['prismatic', '棱彩']];
  return `<details class="augment-library"><summary>浏览现役海克斯图鉴 <b>${number(db.augments.length)} 张</b><small>本轮仍按随机三选一获取</small></summary><input class="augment-library-search" type="search" data-augment-search placeholder="搜索海克斯名称或效果…" aria-label="搜索海克斯图鉴"><div class="augment-library-body">${groups.map(([rarity, label]) => {
    const cards = db.augments.filter(card => card.rarity === rarity).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return `<section><h3>${label} <small>${cards.length} 张</small></h3><div>${cards.map(card => `<article><strong>${escapeHtml(card.name)}</strong><p>${escapeHtml(safeEffect(card))}</p></article>`).join('')}</div></section>`;
  }).join('')}</div></details>`;
}
function augmentDraft() {
  const cards = (game.augmentOffers || []).map(augment).filter(Boolean);
  return `<div class="stage-heading"><div><span class="tiny-label">ROUND ${number(game.round)} / AUGMENT DRAFT</span><h1>选一条强化路线</h1><p>三张随机候选，可将整组三张刷新一次。每轮选取的强化会累积到最终构筑。</p></div><span class="stage-count">LV.${number(game.player.level)} · ${number(game.augmentRerollsRemaining)} 次刷新</span></div>${game.lastRound ? compactLastRound() : ''}<div class="augment-grid">${cards.map((card, index) => `<button class="augment-choice ${escapeHtml(card.rarity)}" data-action="choose-augment" data-id="${escapeHtml(card.id)}"><span class="augment-index">0${index + 1} / ${rarityName(card.rarity)}</span>${image(card.icon, card.name, 'augment-art')}<strong>${escapeHtml(card.name)}</strong><span class="augment-copy">${escapeHtml(safeEffect(card))}</span><em>选择此强化 ↗</em></button>`).join('')}</div><div class="stage-actions"><button class="outline-button" data-action="reroll-augment" ${game.augmentRerollsRemaining <= 0 ? 'disabled' : ''}>↻ 刷新整组三张 ${game.augmentRerollsRemaining <= 0 ? '· 已使用' : ''}</button></div>${augmentLibrary()}`;
}
function inventoryPanel() {
  const owned = game.player.itemIds.map(id => lookup('items', id)).filter(Boolean);
  const chosen = game.player.augmentIds.map(id => lookup('augments', id)).filter(Boolean);
  const panel = computeBuild({ champion: hero(game.player.championId), level: game.player.level, items: owned, augments: chosen, growth: game.player.growth || {} }).stats;
  return `<div class="inventory-panel"><div class="inventory-head"><h2>本局构筑</h2><span>${owned.length} / 6 装备</span></div><div class="inventory-items">${owned.length ? owned.map(item => `<span class="owned-item">${image(item.icon, item.name)}<span><b>${escapeHtml(item.name)}</b><small>${categoryName(item.category)}</small></span>${game.phase === 'shop' ? `<button data-action="sell-item" data-id="${escapeHtml(item.id)}" aria-label="出售${escapeHtml(item.name)}">×</button>` : ''}</span>`).join('') : '<p class="empty-state">还没有购买装备。</p>'}</div><div class="inventory-augments">${chosen.map(card => `<span class="augment-token ${escapeHtml(card.rarity)}">${escapeHtml(card.name)}</span>`).join('') || '<span class="empty-state">本局海克斯尚未选择。</span>'}</div><div class="mini-panel-stats"><span>生命<b>${number(panel.hp)}</b></span><span>攻击<b>${number(panel.ad)}</b></span><span>法强<b>${number(panel.ap)}</b></span><span>护甲<b>${number(panel.armor)}</b></span></div></div>`;
}
function hasMaterial(item) {
  const needs = [...(item.from || [])].map(String);
  const owned = [...game.player.itemIds].map(String);
  const consumed = [];
  for (const need of needs) {
    const index = owned.indexOf(need);
    if (index >= 0) { owned.splice(index, 1); consumed.push(lookup('items', need)); }
  }
  return consumed.filter(Boolean);
}
function itemCost(item) {
  return Math.max(0, (item.shopCost ?? item.gold) - hasMaterial(item).reduce((sum, component) => sum + Number(component.shopCost ?? component.gold ?? 0), 0));
}
function previewSynergies(item, activeIds) {
  const remaining = [...game.player.itemIds];
  for (const component of hasMaterial(item)) remaining.splice(remaining.indexOf(component.id), 1);
  const preview = { ...game, player: { ...game.player, itemIds: [...remaining, item.id] } };
  return getSynergies(preview, db).filter(entry => !activeIds.has(entry.id));
}
function shopCatalog() {
  const query = ui.search.trim().toLowerCase();
  const available = db.items.filter(item => (item.shopCost ?? item.gold) > 0 && item.purchasable !== false && ['component', 'starter', 'legendary', 'boots'].includes(item.category));
  const filtered = available.filter(item => (ui.itemFilter === 'all' || item.category === ui.itemFilter)
    && (!query || [item.name, item.english, item.id].some(value => String(value || '').toLowerCase().includes(query))));
  const activeIds = new Set(getSynergies(game, db).map(entry => entry.id));
  const synergyHints = new Map(filtered.map(item => [item.id, previewSynergies(item, activeIds)]));
  const role = hero(game.player.championId)?.tags?.[0];
  const score = item => {
    const stats = item.stats || {};
    if (role === 'Mage' || role === 'Support') return (stats.FlatMagicDamageMod || 0) * 3 + (item.extras?.haste || 0);
    if (role === 'Tank') return (stats.FlatHPPoolMod || 0) / 5 + (stats.FlatArmorMod || 0) * 2 + (stats.FlatSpellBlockMod || 0) * 2;
    return (stats.FlatPhysicalDamageMod || 0) * 3 + (stats.PercentAttackSpeedMod || 0) * 110;
  };
  filtered.sort((a, b) => synergyHints.get(b.id).length - synergyHints.get(a.id).length || score(b) - score(a) || a.gold - b.gold);
  return filtered.map(item => {
    const cost = itemCost(item);
    const consumed = hasMaterial(item);
    const owned = ['legendary', 'boots'].includes(item.category) && game.player.itemIds.includes(item.id);
    const full = game.player.itemIds.length - consumed.length >= 6;
    const remaining = [...game.player.itemIds];
    consumed.forEach(component => remaining.splice(remaining.indexOf(component.id), 1));
    const shoe = item.category === 'boots' && remaining.some(id => lookup('items', id)?.category === 'boots');
    const reason = owned ? '已拥有' : full ? '背包已满' : shoe ? '已有鞋子' : game.player.gold < cost ? '金币不足' : '';
    const hint = synergyHints.get(item.id)?.[0];
    return `<button class="shop-item" data-action="buy-item" data-id="${escapeHtml(item.id)}" ${reason ? 'disabled' : ''} title="${escapeHtml(item.name)}${hint ? ` · 可触发${hint.title}` : ''}${reason ? ` · ${reason}` : ''}">${image(item.icon, item.name)}<span><b>${escapeHtml(item.name)}</b><small>${categoryName(item.category)}${consumed.length ? ' · 已持有组件抵扣' : ''}</small>${hint ? `<small class="shop-synergy">✦ ${escapeHtml(hint.title)}</small>` : ''}</span><em>${number(cost)} G</em></button>`;
  }).join('') || '<p class="empty-state">没有找到装备，试试别的名称或类别。</p>';
}
function shop() {
  const filters = [['all', '全部'], ['legendary', '成装'], ['component', '组件'], ['boots', '鞋子'], ['starter', '出门装']];
  const categories = new Set(db.items.map(item => item.category));
  return `<div class="stage-heading"><div><span class="tiny-label">ROUND ${number(game.round)} / WAR ROOM</span><h1>让装备决定下一波</h1><p>胜负、击杀与助攻会带来不同金币。购物后面板立即更新；持有配方组件时，合成装备可抵扣其价值。</p></div><span class="stage-count">${number(game.player.gold)} G 可用</span></div>${game.lastRound ? compactLastRound() : ''}<div class="shop-layout"><div class="shop-panel"><div class="shop-tools"><h2>装备商店 <small>${db.items.filter(item => (item.shopCost ?? item.gold) > 0 && item.purchasable !== false && ['component', 'starter', 'legendary', 'boots'].includes(item.category)).length} 件可购</small></h2><input class="shop-search" type="search" data-shop-search placeholder="搜索装备、英文名或 ID…" value="${escapeHtml(ui.search)}" aria-label="搜索装备"></div><div class="shop-filters">${filters.filter(([id]) => id === 'all' || categories.has(id)).map(([id, label]) => `<button class="${ui.itemFilter === id ? 'active' : ''}" data-action="item-filter" data-id="${id}">${label}</button>`).join('')}</div><div class="shop-grid">${shopCatalog()}</div></div><div class="shop-side">${inventoryPanel()}<div class="war-ready"><h2>选目标，再进入团战</h2><p>先点名集火目标，再依次决定开团、临场应对和收尾。团战后还要选择推进、补给或防守。</p><button class="major-button" data-action="start-fight">装备就绪 · 进入团战 <span>↗</span></button></div></div></div>`;
}
function enemyScout() {
  const enemies = game.enemies || [];
  const items = enemies.reduce((sum, unit) => sum + unit.itemIds.length, 0);
  const augments = enemies.reduce((sum, unit) => sum + unit.augmentIds.length, 0);
  return `<details class="enemy-scout"><summary><span>侦查敌方构筑 <small>逐轮成长，针对阵容选择战术</small></span><b>${number(items)} 件装备 · ${number(augments)} 个强化</b></summary><div class="enemy-scout-grid">${enemies.map(unit => {
    const champion = hero(unit.championId);
    const gear = unit.itemIds.map(id => lookup('items', id)?.name).filter(Boolean);
    const powers = unit.augmentIds.map(id => lookup('augments', id)?.name).filter(Boolean);
    return `<article><strong>${escapeHtml(champion?.name || unit.championId)}</strong><small>${escapeHtml(gear.join(' · ') || '尚未出装')}</small><em>${escapeHtml(powers.join(' · ') || '尚未选择强化')}</em></article>`;
  }).join('')}</div></details>`;
}
function mapStatus() {
  const towers = game.towers || { ally: 100, enemy: 100 };
  const control = Number(game.mapControl || 0);
  return `<div class="map-status" aria-label="地图推进"><div><span>我方防御塔</span><b>${number(towers.ally)}%</b><i><em style="width:${Math.max(0, Math.min(100, towers.ally))}%"></em></i></div><strong>地图控制 ${control > 0 ? '+' : ''}${number(control)}</strong><div><span>敌方防御塔</span><b>${number(towers.enemy)}%</b><i><em style="width:${Math.max(0, Math.min(100, towers.enemy))}%"></em></i></div></div>`;
}
function targetDraft() {
  return `<div class="stage-heading"><div><span class="tiny-label">ROUND ${number(game.round)} / TARGET CALL</span><h1>这一波，先集火谁？</h1><p>点名一名敌方英雄作为团战优先目标。你的切入路线和队友的集火都会围绕他展开；对面前排与反打仍会造成威胁。</p></div><span class="stage-count">选择 1 / 5</span></div>${mapStatus()}<div class="target-grid">${game.enemies.map((unit, index) => {
    const champion = hero(unit.championId);
    if (!champion) return '';
    return `<button class="target-card" data-action="choose-target" data-id="${escapeHtml(champion.id)}"><span class="target-number">TARGET 0${index + 1}</span>${image(champion.icon, champion.name)}<strong>${escapeHtml(champion.name)}</strong><small>${escapeHtml(champion.tags.map(roleName).join(' / '))}</small><em>${number(unit.itemIds.length)} 装 · ${number(unit.augmentIds.length)} 强化</em><b>优先集火 ↗</b></button>`;
  }).join('')}</div>${enemyScout()}`;
}
function focusTargetLabel() {
  const target = hero(game.priorityTargetId);
  return target ? `<div class="focus-strip">本轮优先目标 <strong>${escapeHtml(target.name)}</strong><span>${escapeHtml(target.tags.map(roleName).join(' / '))} · 集火会改变目标选择与输出分配</span></div>` : '';
}
function tactic() {
  const stage = game.tacticStage || 'engage';
  const options = TACTIC_OPTIONS?.[stage] || [];
  const index = ['engage', 'response', 'finish'].indexOf(stage);
  return `<div class="stage-heading"><div><span class="tiny-label">ROUND ${number(game.round)} / LIVE TEAMFIGHT</span><h1>${tacticStageNames[stage] || '临场抉择'}</h1><p>同一套构筑也能打出不同结果。选择会即时记录，三步完成后给出团战与经济结算。</p></div><span class="stage-count">决策 ${index + 1} / 3</span></div><div class="tactic-timeline">${['engage', 'response', 'finish'].map((step, position) => `<span class="${position === index ? 'current' : position < index ? 'done' : ''}"><b>0${position + 1}</b>${tacticStageNames[step]}</span>`).join('')}</div><div class="battle-scene"><div class="battle-side ally"><span>我方阵容</span>${[game.player, ...game.allies].map(unit => unitCard(unit, 'ally')).join('')}</div><strong>VS</strong><div class="battle-side enemy"><span>敌方阵容</span>${game.enemies.map(unit => unitCard(unit, 'enemy')).join('')}</div></div>${focusTargetLabel()}${enemyScout()}<div class="tactic-options">${options.map((option, position) => `<button class="tactic-card" data-action="choose-tactic" data-id="${escapeHtml(option.id)}"><small>TACTIC 0${position + 1}</small><strong>${escapeHtml(option.name)}</strong><p>${escapeHtml(option.description)}</p><em>执行战术 ↗</em></button>`).join('')}</div>${(game.pendingTactics || []).length ? `<div class="chosen-tactics"><span>本轮已经执行</span>${game.pendingTactics.map(item => `<b>${escapeHtml(item.name)}</b>`).join('<i>→</i>')}</div>` : ''}`;
}
function unitCard(unit, side) {
  const champion = hero(unit.championId);
  if (!champion) return '';
  const pct = Math.max(0, Math.min(100, Math.round(100 * Number(unit.hp || 0) / Number(unit.maxHp || 1))));
  return `<span class="unit-card ${side}">${image(champion.icon, champion.name)}<span><b>${escapeHtml(champion.name)}</b><small>LV.${number(unit.level)} · ${pct}% HP</small></span></span>`;
}
function economyBreakdown(economy, winner) {
  if (!economy) return '';
  const values = [['基础收益', economy.base], [winner === 'ally' ? '团战胜利' : '失利补助', economy.winBonus], ['个人击杀', economy.killBonus], ['参与助攻', economy.assistBonus]];
  if (economy.streakBonus) values.push(['连胜奖励', economy.streakBonus]);
  if (economy.objectiveBonus != null) values.push(['战后决策', economy.objectiveBonus]);
  return `<div class="economy-breakdown">${values.map(([label, value]) => `<span>${label}<b>${value < 0 ? '−' : '+'}${number(Math.abs(value))} G</b></span>`).join('')}<strong>本轮收入 <b>+${number(economy.total)} G</b></strong></div>`;
}
function compactLastRound() {
  const last = game.lastRound;
  return `<div class="last-round-strip ${last.winner === 'ally' ? 'win' : 'lose'}"><span>上一轮 ${last.winner === 'ally' ? '团战胜利' : '团战失利'}</span><b>${number(last.playerDamage)} 伤害 · ${number(last.playerKills)} 击杀${last.objective ? ` · ${escapeHtml(last.objective.name)}` : ''}</b><em>收入 +${number(last.economy?.total)} G</em></div>`;
}
function objective() {
  const round = game.lastRound;
  if (!round) return '<p class="empty-state">正在结算战场…</p>';
  const focus = round.focusTarget;
  const options = getObjectiveOptions(game);
  return `<div class="stage-heading"><div><span class="tiny-label">ROUND ${number(game.round)} / POST FIGHT</span><h1>${round.winner === 'ally' ? '团战赢了，下一步？' : '团战失利，如何止损？'}</h1><p>团战结果已经结算。选择战后行动会改变塔的耐久、地图控制与本轮最终收入；最后一轮可以尝试偷塔。</p></div><span class="stage-count">${number(game.score.ally)} : ${number(game.score.enemy)}</span></div><div class="result-hero ${round.winner === 'ally' ? 'win' : 'lose'}"><span>${round.winner === 'ally' ? 'TEAMFIGHT WON' : 'TEAMFIGHT LOST'}</span><div><b>个人伤害<strong>${number(round.playerDamage)}</strong></b><b>击倒人数<strong>${number(round.playerKills)}</strong></b><b>存活对比<strong>${number(round.remaining?.ally)} : ${number(round.remaining?.enemy)}</strong></b></div></div>${focus ? `<div class="focus-outcome">集火目标 <strong>${escapeHtml(focus.name)}</strong><span>${focus.killed ? '已被击倒' : `幸存 · 剩余 ${number(focus.remainingHp)} 生命`}</span></div>` : ''}${mapStatus()}<div class="objective-heading"><h2>选择战后行动</h2><span>已获得团战收入 +${number(round.economy?.total)} G · 行动结果将在战报中结算</span></div><div class="objective-grid">${options.map((option, index) => `<button class="objective-card ${option.id === 'backdoor' ? 'backdoor' : ''}" data-action="choose-objective" data-id="${escapeHtml(option.id)}"><small>PLAN 0${index + 1}</small><strong>${escapeHtml(option.name)}</strong><p>${escapeHtml(option.description)}</p><em>执行行动 ↗</em></button>`).join('')}</div>`;
}
function report() {
  const round = game.lastRound;
  if (!round) return '<p class="empty-state">战报正在生成…</p>';
  const events = round.events || [];
  const synergy = round.synergies || getSynergies(game, db);
  const decision = round.objective;
  const focus = round.focusTarget;
  const objectiveOutcome = decision ? `<div class="objective-outcome"><div><span>战后行动</span><strong>${escapeHtml(decision.name)}</strong><em>行动收入 ${decision.gold < 0 ? '−' : '+'}${number(Math.abs(decision.gold))} G</em></div><p>${escapeHtml(decision.text)}</p><small>敌塔 -${number(decision.towerDamage)} · 我方塔 -${number(decision.ownTowerDamage)} · 地图控制 ${decision.mapControlDelta > 0 ? '+' : ''}${number(decision.mapControlDelta)}${decision.backdoorChance != null ? ` · 偷塔成功率 ${number(decision.backdoorChance * 100)}%：${decision.backdoorSuccess ? '成功' : '失败'}` : ''}</small></div>` : '';
  return `<div class="stage-heading"><div><span class="tiny-label">ROUND ${number(game.round)} / AFTER ACTION</span><h1>${round.winner === 'ally' ? '这波团，打赢了。' : '这波团，失守了。'}</h1><p>集火、团战与战后行动都已结算；完整经济会进入下一轮商店。</p></div><span class="stage-count">比分 ${number(game.score.ally)} : ${number(game.score.enemy)}</span></div>
    <div class="result-hero ${round.winner === 'ally' ? 'win' : 'lose'}"><span>${round.winner === 'ally' ? 'VICTORY' : 'DEFEAT'}</span><div><b>个人伤害<strong>${number(round.playerDamage)}</strong></b><b>个人击杀<strong>${number(round.playerKills)}</strong></b><b>存活人数<strong>${number(round.remaining?.ally)} : ${number(round.remaining?.enemy)}</strong></b></div></div>
    ${focus ? `<div class="focus-outcome">集火目标 <strong>${escapeHtml(focus.name)}</strong><span>${focus.killed ? '成功击倒' : `未击倒 · 剩余 ${number(focus.remainingHp)} 生命`}</span></div>` : ''}
    ${objectiveOutcome}${mapStatus()}${enemyScout()}
    <div class="report-grid"><section class="report-panel"><h2>战场纪事</h2>${events.length ? events.slice(0, 9).map((entry, index) => `<p><b>${String(index + 1).padStart(2, '0')}</b>${escapeHtml(entry)}</p>`).join('') : '<p>双方激战，胜负由整体战力和战术结算。</p>'}</section><section class="report-panel"><h2>经济结算</h2>${economyBreakdown(round.economy, round.winner)}${synergy.length ? `<h2 class="report-subhead">触发联动</h2>${synergy.slice(0, 5).map(entry => `<p class="synergy-report"><b>✦</b><span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.detail)}</small></span></p>`).join('')}` : ''}</section></div>
    <div class="stage-actions"><button class="major-button" data-action="advance-round">${game.round >= game.maxRounds ? '查看最终结局' : '进入下一轮'} <span>↗</span></button></div>`;
}
function finished() {
  const winner = game.result?.winner === 'ally';
  const finalObjective = game.rounds?.at(-1)?.objective;
  return `<div class="stage-heading"><div><span class="tiny-label">MATCH COMPLETE / MAYHEM CHRONICLES</span><h1>${winner ? '这局海斗，属于你们。' : '战役落幕，再来一局。'}</h1><p>${escapeHtml(game.result?.reason || '四轮团战已经结束。')} 团战、推进与收入都记录在下方。</p></div><span class="stage-count">${number(game.score.ally)} : ${number(game.score.enemy)}</span></div><div class="final-card ${winner ? 'win' : 'lose'}"><span>${winner ? 'TEAM VICTORY' : 'TEAM DEFEAT'}</span><strong>${winner ? '胜 利' : '失 利'}</strong><div><span>个人击杀 <b>${number(game.player.kills)}</b></span><span>总装备 <b>${game.player.itemIds.length}</b></span><span>强化选择 <b>${game.player.augmentIds.length}</b></span><span>最终金币 <b>${number(game.player.gold)}</b></span></div></div>${finalObjective?.id === 'backdoor' ? `<div class="backdoor-result ${finalObjective.backdoorSuccess ? 'success' : 'failure'}">偷塔行动${finalObjective.backdoorSuccess ? '成功' : '失败'} · ${escapeHtml(finalObjective.text)}</div>` : ''}${mapStatus()}<div class="round-history"><h2>四轮战役记录</h2>${(game.rounds || []).map(round => `<div><b>R${number(round.round)}</b><span class="${round.winner === 'ally' ? 'win' : 'lose'}">${round.winner === 'ally' ? '我方胜' : '敌方胜'}</span><span>${escapeHtml(round.objective?.name || '未选择行动')}</span><span>+${number(round.economy?.total)} G</span></div>`).join('')}</div><div class="stage-actions"><button class="major-button" data-action="restart">再匹配一局 <span>↻</span></button><a class="outline-link" href="https://xiaokai2810.github.io/haidou-lunzhan/">去构筑实验室研究配装 ↗</a></div>`;
}
function sidePanel() {
  if (!game) return '';
  const player = game.player;
  const champion = player ? hero(player.championId) : null;
  const synergy = player ? getSynergies(game, db) : [];
  const roster = player ? `<div class="roster-side"><h3>本场阵容</h3><div class="roster-line"><span>我方</span>${[player, ...(game.allies || [])].map(unit => unitCard(unit, 'ally')).join('')}</div><div class="roster-line"><span>敌方</span>${(game.enemies || []).map(unit => unitCard(unit, 'enemy')).join('')}</div></div>` : '';
  return `<aside class="dossier"><div class="dossier-head"><span class="tiny-label">MATCH DOSSIER</span><b>#${escapeHtml(game.seed)}</b></div><div class="score-board"><span><small>我方</small><b>${number(game.score?.ally)}</b></span><i>:</i><span><small>敌方</small><b>${number(game.score?.enemy)}</b></span></div><div class="dossier-line"><span>防御塔耐久</span><strong>我方 ${number(game.towers?.ally ?? 100)}% · 敌方 ${number(game.towers?.enemy ?? 100)}%</strong></div><div class="dossier-line"><span>地图控制</span><strong>${(game.mapControl || 0) > 0 ? "+" : ""}${number(game.mapControl || 0)}</strong></div><div class="dossier-line"><span>当前阶段</span><strong>${phaseNames[game.phase] || '准备中'}</strong></div><div class="dossier-line"><span>回合进度</span><strong>${number(game.round)} / ${number(game.maxRounds)}</strong></div>${player ? `<div class="dossier-line"><span>金币</span><strong class="gold">${number(player.gold)} G</strong></div><div class="player-portrait">${image(champion?.icon, champion?.name || '')}<span><small>你的英雄</small><strong>${escapeHtml(champion?.name || '')}</strong><em>LV.${number(player.level)} · ${number(player.hp)} / ${number(player.maxHp)} HP</em></span></div><div class="dossier-section"><h3>海克斯强化</h3><div class="dossier-tokens">${player.augmentIds.map(id => lookup('augments', id)).filter(Boolean).map(card => `<span class="${escapeHtml(card.rarity)}">${escapeHtml(card.name)}</span>`).join('') || '<small>尚未选择</small>'}</div></div><div class="dossier-section"><h3>装备路线</h3><div class="dossier-items">${player.itemIds.map(id => lookup('items', id)).filter(Boolean).map(item => `<span title="${escapeHtml(item.name)}">${image(item.icon, item.name)}</span>`).join('') || '<small>尚未购买</small>'}</div></div><div class="dossier-section synergy-section"><h3>当前联动 <small>${synergy.length}</small></h3>${synergy.length ? synergy.slice(0, 6).map(entry => `<div class="synergy-entry"><b>${escapeHtml(entry.title)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('') : '<p>选择英雄后，通过海克斯与装备激活组合。</p>'}</div>${roster}` : `<div class="dossier-empty"><strong>英雄尚未锁定</strong><p>两张随机英雄卡正在等待你的决定。</p></div>`}</aside>`;
}
function stage() {
  if (!game) return intro();
  if (game.phase === 'hero_draft') return heroDraft();
  if (game.phase === 'augment_draft') return augmentDraft();
  if (game.phase === 'shop') return shop();
  if (game.phase === 'target') return targetDraft();
  if (game.phase === 'tactic') return tactic();
  if (game.phase === 'objective') return objective();
  if (game.phase === 'report') return report();
  return finished();
}
function render() {
  if (!db) return;
  document.title = `${phaseNames[game?.phase] || '海斗战记'} · 海斗战记`;
  root.innerHTML = `${topbar()}<main class="game-shell">${game ? progress() : ''}<div class="game-layout ${game ? '' : 'is-home'}"><div class="game-stage" id="game-stage">${stage()}${ui.error ? `<p class="game-error" role="alert">${escapeHtml(ui.error)}</p>` : ''}</div>${sidePanel()}</div></main><footer class="game-footer"><span>海斗战记 / 非官方爱好者文字游戏</span><span>随机候选、联动系数、战术和经济数值均为本站规则；结果不是实战胜率。</span><a href="${escapeHtml(db.meta.sources.patchNotes)}" target="_blank" rel="noopener">当前版本规则 ↗</a></footer>`;
}
function update(action, scroll = true) {
  const before = game?.phase;
  const beforeTacticStage = game?.tacticStage;
  try {
    game = action();
    ui.error = '';
    ui.resetArmed = false;
    save();
    render();
    if (scroll && (before !== game.phase || beforeTacticStage !== game.tacticStage)) document.querySelector('#game-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    ui.error = error?.message || '操作未完成，请重试。';
    render();
  }
}
function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button || !root.contains(button)) return;
  const { action, id } = button.dataset;
  if (action === 'reset') {
    if (!ui.resetArmed) { ui.resetArmed = true; render(); return; }
    game = null; ui = { focusHero: null, itemFilter: 'all', search: '', error: '', resetArmed: false };
    save(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
  }
  if (action === 'start' || action === 'restart') {
    ui = { focusHero: null, itemFilter: 'all', search: '', error: '', resetArmed: false };
    update(() => createStandaloneGame({ db, seed: Math.floor(Math.random() * 0x7fffffff) + 1 })); return;
  }
  if (!game) return;
  if (action === 'focus-hero') { ui.focusHero = id; render(); return; }
  if (action === 'swap-hero') { update(() => swapHeroFromBench(game, id, ui.focusHero || cardId(game.heroOffers[0]), db), false); return; }
  if (action === 'choose-hero') { update(() => chooseHero(game, id, db)); return; }
  if (action === 'reroll-augment') { update(() => rerollAugments(game, db), false); return; }
  if (action === 'choose-augment') { update(() => chooseAugment(game, id, db)); return; }
  if (action === 'item-filter') { ui.itemFilter = id; render(); return; }
  if (action === 'buy-item') { update(() => buyItem(game, id, db), false); return; }
  if (action === 'sell-item') { update(() => sellItem(game, id, db), false); return; }
  if (action === 'start-fight') { update(() => startFight(game, db)); return; }
  if (action === 'choose-target') { update(() => choosePriorityTarget(game, id, db)); return; }
  if (action === 'choose-tactic') { update(() => chooseTactic(game, id, db)); return; }
  if (action === 'choose-objective') { update(() => chooseObjective(game, id, db)); return; }
  if (action === 'advance-round') { update(() => advanceRound(game, db)); return; }
}
function onInput(event) {
  if (event.target.matches('[data-augment-search]')) {
    const query = event.target.value.trim().toLowerCase();
    for (const section of root.querySelectorAll('.augment-library-body section')) {
      for (const card of section.querySelectorAll('article')) card.hidden = !card.textContent.toLowerCase().includes(query);
      section.hidden = !Array.from(section.querySelectorAll('article')).some(card => !card.hidden);
    }
    return;
  }
  if (!event.target.matches('[data-shop-search]')) return;
  ui.search = event.target.value;
  const list = root.querySelector('.shop-grid');
  if (list) list.innerHTML = shopCatalog();
}
async function init() {
  root.innerHTML = '<div class="page-loading">正在载入海斗战场…</div>';
  try {
    const names = ['champions', 'augments', 'items', 'meta'];
    const entries = await Promise.all(names.map(async name => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`);
      if (!response.ok) throw new Error(`无法载入 ${name} 数据`);
      return [name, await response.json()];
    }));
    db = Object.fromEntries(entries);
    restore();
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('error', event => {
      if (event.target.matches?.('.art-icon img')) event.target.remove();
    }, true);
    render();
  } catch (error) {
    root.innerHTML = `<div class="page-loading"><h1>战场数据加载失败</h1><p>${escapeHtml(error.message)}</p><button onclick="location.reload()">重新加载</button></div>`;
  }
}
init();
