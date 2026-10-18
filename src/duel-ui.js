import './duel.css';
import { computeBuild } from './model.js';

const root = document.querySelector('#duel-root');
const base = new URL(import.meta.env.BASE_URL, location.origin);
const apiBase = new URL('api/', base);
const soloUrl = base.href;
const savedNameKey = 'haidou-duel-name';
const lastRoomKey = 'haidou-duel-last-room';
const roomTokenKey = code => `haidou-duel-room-${code}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const fmt = value => Math.round(Number(value) || 0).toLocaleString('zh-CN');
const role = value => ({ Tank: '坦克', Fighter: '战士', Mage: '法师', Marksman: '射手', Assassin: '刺客', Support: '辅助' })[value] || value || '未知';
const rarity = value => ({ silver: '白银', gold: '黄金', prismatic: '棱彩' })[value] || value || '强化';
const category = value => ({ legendary: '成装', component: '组件', boots: '鞋子', starter: '出门装', consumable: '消耗品' })[value] || value;
const effectText = card => {
  const effect = String(card?.effect || '').trim();
  return effect && !/@[^@]+@|(?:^|\D)0\s*秒/.test(effect)
    ? effect : '部分数值会随对局变化；请根据构筑面板和团战战报观察本站模拟效果。';
};
const phaseTitle = { waiting: '等待好友', hero: '英雄抉择', augment: '海克斯三选一', shop: '装备备战', target: '集火目标', tactic: '团战指挥', objective: '战后推进', report: '回合战报', finished: '对局结算' };
const tacticTitle = { engage: '开团策略', response: '临场应对', finish: '收尾决策' };

let catalog = null;
let game = null;
let token = '';
let revision = -1;
let polling = null;
let pollBusy = false;
let view = {
  name: localStorage.getItem(savedNameKey) || '',
  roomCode: new URLSearchParams(location.search).get('room')?.trim().toUpperCase() || '',
  filter: 'all', search: '', notice: '', error: '', offline: false, busy: false,
};

function roomLink(code) {
  const url = new URL('duel.html', base);
  url.searchParams.set('room', code);
  return url.href;
}
function roomPath(code) { return new URL(`rooms/${encodeURIComponent(code)}`, apiBase); }
function apiPath(path) { return new URL(path, apiBase); }
function champion(id) { return catalog?.champions?.find(entry => entry.id === id); }
function item(id) { return catalog?.items?.find(entry => String(entry.id) === String(id)); }
function augment(id) { return catalog?.augments?.find(entry => entry.id === id); }
function heroName(id) { return champion(id)?.name || id || '未选英雄'; }
function icon(url, label, size = '') { return `<span class="duel-icon ${size}">${url ? `<img src="${esc(url)}" alt="${esc(label)}" loading="lazy">` : '<i>✦</i>'}</span>`; }
function currentSeat() { return Number(game?.you?.seat ?? 0); }
function otherSeat() { return Number(game?.opponent?.seat ?? (currentSeat() === 0 ? 1 : 0)); }
function isLocked() { return Boolean(game?.locked?.[currentSeat()]); }
function roomStatus() {
  if (view.offline) return '<span class="net-pill offline">● 连接中断，自动重试</span>';
  return game ? '<span class="net-pill online">● 已连接房间</span>' : '<span class="net-pill">● 服务器对战</span>';
}
function briefError(error) { return error?.message || '操作未完成，请稍后重试。'; }

async function request(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || `服务器返回 ${response.status}`);
  return data;
}
function saveRoom(code, secret) {
  localStorage.setItem(roomTokenKey(code), secret);
  localStorage.setItem(lastRoomKey, code);
  history.replaceState({}, '', roomLink(code));
  view.roomCode = code;
}
function setPacket(packet, secret = token) {
  if (!packet?.state) throw new Error('房间数据格式不正确');
  const nextRevision = Number(packet.revision ?? packet.state.revision ?? revision + 1);
  if (game && nextRevision < revision) return;
  const previousPhase = game?.phase;
  const previousRound = game?.round;
  revision = nextRevision;
  token = secret;
  game = { ...packet.state, code: packet.code || packet.state.code || game?.code, revision: nextRevision };
  view.error = '';
  view.offline = false;
  if (previousPhase !== game.phase || previousRound !== game.round) {
    view.search = '';
    view.filter = 'all';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  render();
}
async function createRoom() {
  if (!catalog) throw new Error('服务器目录尚未加载，请稍后再试');
  const name = view.name.trim().slice(0, 20) || '召唤师一号';
  const packet = await request(apiPath('rooms'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  localStorage.setItem(savedNameKey, name);
  saveRoom(packet.code, packet.token);
  setPacket(packet, packet.token);
  startPoll();
}
async function joinRoom() {
  if (!catalog) throw new Error('服务器目录尚未加载，请稍后再试');
  const code = view.roomCode.trim().toUpperCase();
  if (!/^[A-Z2-9]{7}$/.test(code)) throw new Error('请输入 7 位房间码');
  const remembered = localStorage.getItem(roomTokenKey(code));
  if (remembered) {
    const packet = await request(roomPath(code), { headers: { Authorization: `Bearer ${remembered}` } });
    saveRoom(code, remembered);
    setPacket(packet, remembered);
  } else {
    const name = view.name.trim().slice(0, 20) || '召唤师二号';
    const packet = await request(new URL(`${encodeURIComponent(code)}/join`, apiPath('rooms/')), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    localStorage.setItem(savedNameKey, name);
    saveRoom(code, packet.token);
    setPacket(packet, packet.token);
  }
  startPoll();
}
async function resumeRoom(code) {
  const remembered = localStorage.getItem(roomTokenKey(code));
  if (!remembered) return;
  const packet = await request(roomPath(code), { headers: { Authorization: `Bearer ${remembered}` } });
  saveRoom(code, remembered);
  setPacket(packet, remembered);
  startPoll();
}
async function sendAction(type, payload = {}) {
  if (!game || !token || view.busy) return;
  view.busy = true;
  view.error = '';
  render();
  try {
    const packet = await request(new URL(`${encodeURIComponent(game.code)}/actions`, apiPath('rooms/')), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, ...payload }),
    });
    setPacket(packet);
  } catch (error) {
    view.error = briefError(error);
  } finally {
    view.busy = false;
    render();
  }
}
function startPoll() {
  if (polling) clearInterval(polling);
  polling = setInterval(async () => {
    if (!game || !token || pollBusy || view.busy) return;
    pollBusy = true;
    try {
      const packet = await request(roomPath(game.code), { headers: { Authorization: `Bearer ${token}` } });
      const remoteRevision = Number(packet.revision ?? packet.state?.revision ?? -1);
      if (remoteRevision > revision || view.offline) setPacket(packet);
    } catch (error) {
      if (!view.offline) { view.offline = true; view.error = `连接暂时中断：${briefError(error)}`; render(); }
    } finally { pollBusy = false; }
  }, 1600);
}
function leaveRoom() {
  if (polling) clearInterval(polling);
  polling = null; game = null; token = ''; revision = -1;
  localStorage.removeItem(lastRoomKey);
  history.replaceState({}, '', new URL('duel.html', base));
  view.roomCode = ''; view.error = ''; view.notice = '';
  render();
}
async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const box = document.createElement('textarea');
      box.value = value; box.style.position = 'fixed'; box.style.opacity = '0';
      document.body.append(box); box.select();
      if (!document.execCommand('copy')) throw new Error('无法自动复制');
      box.remove();
    }
    view.notice = '邀请链接已复制，发给朋友即可加入。';
  } catch {
    view.notice = '长按下方链接并复制，发给朋友即可加入。';
  }
  render();
  if (view.notice.startsWith('长按')) root.querySelector('[data-share-link]')?.select();
}

function header() {
  return `<header class="duel-header"><a class="duel-brand" href="${esc(soloUrl)}"><span class="brand-mark">M<span>✦</span></span><span><b>海斗战记</b><small>DUEL · SERVER EDITION</small></span></a><nav><a href="${esc(soloUrl)}">单机剧情 ↗</a>${roomStatus()}</nav></header>`;
}
function notice() {
  return `${view.notice ? `<div class="duel-notice" role="status">${esc(view.notice)}</div>` : ''}${view.error ? `<div class="duel-error" role="alert">${esc(view.error)}</div>` : ''}`;
}
function landing() {
  const code = view.roomCode;
  return `<main class="duel-landing"><section class="landing-hero"><div class="landing-copy"><span class="eyebrow">LIVE · 1V1 ROOM MATCH</span><h1>叫上朋友。<br><em>这次，战报由你们写。</em></h1><p>两人分别控制一名英雄，搭配四名人机。随机英雄、海克斯三选一、装备经营和每波团战决策都在同一个房间里同步。</p><div class="landing-features"><span><b>01</b> 创建房间码</span><span><b>02</b> 发给朋友</span><span><b>03</b> 双方锁定后结算</span></div></div><div class="landing-art"><div class="versus">你 <strong>VS</strong> 好友</div><div class="battle-line"></div><p>同一局战场<br>两个独立决定</p></div></section><section class="lobby-entry"><div class="lobby-intro"><span class="eyebrow">MATCHMAKING</span><h2>开始双人对战</h2><p>朋友通过同一房间码加入。刷新网页后可继续本局；房间由服务器保存。</p></div><form id="room-form" class="room-form"><label>你的称呼<input name="name" maxlength="20" autocomplete="nickname" value="${esc(view.name)}" placeholder="输入昵称（可选）"></label><div class="room-actions"><button class="primary" type="submit" data-form-action="create" ${!catalog || view.busy ? 'disabled' : ''}>创建新房间 <span>↗</span></button><div class="join-line"><input name="code" aria-label="房间码" maxlength="10" autocapitalize="characters" value="${esc(code)}" placeholder="输入房间码"><button class="secondary" type="submit" data-form-action="join" ${!catalog || view.busy ? 'disabled' : ''}>加入房间</button></div></div></form>${notice()}<div class="lobby-foot"><span>• 双方各操控 1 名英雄 + 4 名人机</span><span>• 4 回合海克斯、出装与团战博弈</span><span>• 所有抽取与战斗由服务器结算</span></div></section></main>`;
}
function progress() {
  const steps = [['hero','英雄'],['augment','海克斯'],['shop','备战'],['target','目标'],['tactic','团战'],['objective','推进'],['report','战报']];
  const current = steps.findIndex(([id]) => id === game.phase);
  return `<div class="duel-progress">${steps.map(([id,label],index) => `<div class="${index === current ? 'active' : index < current ? 'complete' : ''}"><b>0${index + 1}</b><span>${label}</span></div>`).join('')}</div>`;
}
function playerMark(player, mine) {
  const pick = champion(player?.championId);
  return `<div class="player-mark ${mine ? 'mine' : 'rival'}">${icon(pick?.icon, pick?.name || '未选', 'large')}<span><small>${mine ? '你 · SLOT 0' + (currentSeat() + 1) : '对手 · SLOT 0' + (otherSeat() + 1)}</small><b>${esc(player?.name || (mine ? '你' : '等待加入'))}</b><em>${esc(pick?.name || (game.phase === 'hero' ? '正在选英雄' : '尚未入场'))}</em></span>${game.status === 'playing' ? `<strong>${game.locked?.[player?.seat] ? '已锁定' : '决策中'}</strong>` : ''}</div>`;
}
function scorePanel() {
  const mine = currentSeat(); const rival = otherSeat();
  return `<section class="match-score"><div class="score-line"><span>第 ${fmt(game.round || 1)} / ${fmt(game.maxRounds || 4)} 回合</span><b>${fmt(game.score?.[mine])} <i>:</i> ${fmt(game.score?.[rival])}</b><span>胜场</span></div><div class="tower-line"><span>我方塔 ${fmt(game.towers?.[mine] ?? 100)}%</span><div><i style="width:${Math.max(0,Math.min(100,Number(game.towers?.[mine] ?? 100)))}%"></i></div><span>敌方塔 ${fmt(game.towers?.[rival] ?? 100)}%</span></div></section>`;
}
function roomRibbon() {
  return `<section class="room-ribbon"><div><small>ROOM CODE / 邀请好友</small><strong>${esc(game.code)}</strong><span>${game.status === 'waiting' ? '房间已创建，等待另一名玩家加入。' : `当前阶段 · ${phaseTitle[game.phase] || game.phase}`}</span></div><div class="room-share"><input data-share-link readonly aria-label="邀请链接" value="${esc(roomLink(game.code))}"><button class="secondary" data-action="copy-link">复制邀请链接</button><button class="quiet" data-action="leave-room">返回大厅</button></div></section>`;
}
function waitingBanner() {
  if (!isLocked()) return '';
  return `<div class="waiting-banner" role="status"><span class="waiting-orbit">✦</span><div><b>你的选择已锁定</b><p>正在等待 ${esc(game.opponent?.name || '好友')} 完成这一阶段。双方都提交后，服务器会自动推进。</p></div></div>`;
}
function stageHeading(kicker, title, description, trailing = '') {
  return `<div class="stage-heading"><div><span class="eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${trailing ? `<strong>${esc(trailing)}</strong>` : ''}</div>`;
}
function teamStrip() {
  const teams = game.teams || [];
  if (!teams.length) return '';
  return `<div class="team-strip">${teams.map(team => `<div class="team-side ${Number(team.seat) === currentSeat() ? 'mine' : 'rival'}"><small>${Number(team.seat) === currentSeat() ? '己方阵容' : '敌方阵容'}</small><div>${(team.units || []).map(unit => { const pick = champion(unit.championId); return `<span title="${esc(unit.name || pick?.name || unit.championId)}">${icon(pick?.icon, pick?.name || unit.name || '')}</span>`; }).join('')}</div></div>`).join('<strong class="team-vs">VS</strong>')}</div>`;
}

function waitingRoom() {
  return `<section class="stage-card waiting-room">${stageHeading('LOBBY / WAITING', '战场已经就位', '把邀请链接发给朋友。朋友加入后，双方会同时获得随机英雄卡。')}<div class="summon-visual"><div class="summon-dot">✦</div><p>等待第二位召唤师加入<span class="wait-ellipsis">…</span></p></div><div class="waiting-tip"><b>如何联机</b><span>复制上方链接 → 发给好友 → 好友打开后输入昵称加入。</span></div></section>`;
}
function heroDraft() {
  const cards = game.you?.heroOffers || [];
  return `<section class="stage-card">${stageHeading(`ROUND ${game.round} / RANDOM DRAFT`, '命运给了你两张牌', '从服务器随机发出的英雄中选一位。双方锁定后，各自的英雄才会公开。', `${cards.length} 张候选`)}${waitingBanner()}<div class="hero-grid">${cards.map((card,index) => `<button class="hero-card" data-action="choose-hero" data-id="${esc(card.id)}" ${isLocked() || view.busy ? 'disabled' : ''} style="--hero-splash:url('${esc(card.splash)}')"><span>CHAMPION 0${index + 1}</span><div><small>${esc((card.tags || []).map(role).join(' / '))}</small><strong>${esc(card.name)}</strong><em>${esc(card.title)}</em></div><b>锁定英雄 ↗</b></button>`).join('')}</div>${!cards.length && !isLocked() ? '<p class="empty-text">英雄卡正在发放，请稍候。</p>' : ''}</section>`;
}
function augmentDraft() {
  const cards = game.you?.augmentOffers || [];
  const rerolls = Number(game.you?.augmentRerollsRemaining || 0);
  return `<section class="stage-card">${stageHeading(`ROUND ${game.round} / AUGMENT DRAFT`, '三选一，改变下一波', '海克斯由服务器随机发放；这一组可以整体刷新一次。已选强化会持续到终局。', `${rarity(game.you?.offerRarity)} · ${rerolls} 次刷新`)}${waitingBanner()}<div class="augment-grid">${cards.map((card,index) => `<button class="augment-card ${esc(card.rarity)}" data-action="choose-augment" data-id="${esc(card.id)}" ${isLocked() || view.busy ? 'disabled' : ''}><small>0${index + 1} / ${rarity(card.rarity)}</small>${icon(card.icon, card.name, 'large')}<strong>${esc(card.name)}</strong><p>${esc(effectText(card))}</p><b>选择此强化 ↗</b></button>`).join('')}</div><div class="stage-action-row"><button class="secondary" data-action="reroll-augment" ${isLocked() || view.busy || rerolls < 1 ? 'disabled' : ''}>↻ 刷新三张 ${rerolls < 1 ? '· 已用完' : ''}</button><span>当前已获得 ${fmt(game.you?.augmentIds?.length)} 张强化</span></div></section>`;
}

function ownedPartsFor(target) {
  const copy = [...(game.you?.itemIds || [])].map(String);
  const consumed = [];
  for (const componentId of target.from || []) {
    const index = copy.indexOf(String(componentId));
    if (index >= 0) { copy.splice(index, 1); consumed.push(item(componentId)); }
  }
  return consumed.filter(Boolean);
}
function effectiveCost(target) {
  return Math.max(0, Number(target.shopCost ?? target.gold ?? 0) - ownedPartsFor(target).reduce((total, part) => total + Number(part.shopCost ?? part.gold ?? 0), 0));
}
function isBuyable(target) {
  return target?.purchasable !== false && ['legendary', 'component', 'boots', 'starter'].includes(target?.category) && Number(target.shopCost ?? target.gold ?? 0) > 0;
}
function shopItems() {
  const query = view.search.trim().toLowerCase();
  const all = (catalog?.items || []).filter(isBuyable);
  const filtered = all.filter(entry => (view.filter === 'all' || entry.category === view.filter) && (!query || [entry.name, entry.english, entry.id, entry.description].some(value => String(value || '').toLowerCase().includes(query))));
  const owned = (game.you?.itemIds || []).map(String);
  return filtered.map(entry => {
    const parts = ownedPartsFor(entry);
    const cost = effectiveCost(entry);
    const afterParts = [...owned];
    for (const part of parts) afterParts.splice(afterParts.indexOf(String(part.id)), 1);
    const noRoom = afterParts.length >= 6;
    const hasBoots = entry.category === 'boots' && afterParts.some(id => item(id)?.category === 'boots');
    const unique = ['legendary', 'boots'].includes(entry.category) && afterParts.includes(String(entry.id));
    const reason = unique ? '已拥有' : hasBoots ? '已装备鞋子' : noRoom ? '装备栏已满' : Number(game.you?.gold || 0) < cost ? '金币不足' : '';
    return `<button class="store-item" data-action="buy-item" data-id="${esc(entry.id)}" title="${esc(entry.description || entry.name)}" ${isLocked() || view.busy || reason ? 'disabled' : ''}>${icon(entry.icon, entry.name)}<span><b>${esc(entry.name)}</b><small>${esc(category(entry.category))}${parts.length ? ' · 组件抵扣' : ''}</small></span><em>${fmt(cost)} G</em>${reason ? `<span class="store-reason">${esc(reason)}</span>` : ''}</button>`;
  }).join('') || '<p class="empty-text">没有找到装备，试试其他名称或类别。</p>';
}
function panelStats() {
  const you = game?.you;
  const pick = champion(you?.championId);
  if (!pick) return '';
  try {
    const build = computeBuild({ champion: pick, level: you.level || 1, augments: (you.augmentIds || []).map(augment).filter(Boolean), items: (you.itemIds || []).map(item).filter(Boolean), growth: you.growth || {} });
    const stats = build.stats || {};
    return `<div class="stat-grid"><span>生命<b>${fmt(stats.hp)}</b></span><span>攻击<b>${fmt(stats.ad)}</b></span><span>法强<b>${fmt(stats.ap)}</b></span><span>护甲<b>${fmt(stats.armor)}</b></span><span>魔抗<b>${fmt(stats.mr)}</b></span><span>攻速<b>${Number(stats.attackSpeed || stats.as || 0).toFixed(2)}</b></span></div>`;
  } catch { return ''; }
}
function buildPanel() {
  const you = game.you || {};
  const ownItems = (you.itemIds || []).map(item).filter(Boolean);
  const ownAugments = (you.augmentIds || []).map(augment).filter(Boolean);
  return `<section class="build-panel"><div class="build-heading"><h3>你的构筑</h3><span>LV.${fmt(you.level || 1)}</span></div>${panelStats()}<div class="build-sub"><b>装备 ${ownItems.length} / 6</b>${ownItems.length ? `<div class="owned-list">${ownItems.map(entry => `<div>${icon(entry.icon, entry.name)}<span><b>${esc(entry.name)}</b><small>${esc(category(entry.category))}</small></span>${game.phase === 'shop' && !isLocked() ? `<button data-action="sell-item" data-id="${esc(entry.id)}" aria-label="出售${esc(entry.name)}">×</button>` : ''}</div>`).join('')}</div>` : '<p>还没有购买装备。</p>'}</div><div class="build-sub"><b>海克斯 ${ownAugments.length}</b><div class="rune-list">${ownAugments.map(entry => `<span class="${esc(entry.rarity)}">${esc(entry.name)}</span>`).join('') || '<p>尚未选择海克斯。</p>'}</div></div></section>`;
}
function shop() {
  const all = (catalog?.items || []).filter(isBuyable);
  const filters = [['all','全部'],['legendary','成装'],['component','组件'],['boots','鞋子'],['starter','出门装']];
  return `<section class="stage-card">${stageHeading(`ROUND ${game.round} / WAR ROOM`, '装备决定下一波', '胜利与战后推进会扩大经济差。购买、合成或出售装备后，按“备战完成”锁定。', `${fmt(game.you?.gold)} G 可用`)}${waitingBanner()}<div class="shop-wrap"><div class="shop-board"><div class="shop-bar"><h3>全量装备商店 <small>${all.length} 件可购</small></h3><input type="search" data-shop-search aria-label="搜索装备" placeholder="搜索名称、属性或英文名…" value="${esc(view.search)}"></div><div class="shop-filters">${filters.map(([id,label]) => `<button data-action="shop-filter" data-id="${id}" class="${view.filter === id ? 'active' : ''}">${label}</button>`).join('')}</div><div class="store-grid" id="store-grid">${shopItems()}</div></div><div class="shop-side">${buildPanel()}<div class="ready-panel"><span class="eyebrow">LOCK IN YOUR BUILD</span><h3>准备好出战了吗？</h3><p>双方备战完成后，进入目标选择。未花完金币也可以继续。</p><button class="primary" data-action="ready-shop" ${isLocked() || view.busy ? 'disabled' : ''}>备战完成 · 锁定装备 ↗</button></div></div></div></section>`;
}
function enemyUnits() {
  const team = (game.teams || []).find(entry => Number(entry.seat) === otherSeat());
  if (team?.units?.length) return team.units;
  return [game.opponent, ...(game.opponent?.allies || [])].filter(unit => unit?.championId);
}
function target() {
  const enemies = enemyUnits();
  return `<section class="stage-card">${stageHeading(`ROUND ${game.round} / TARGET CALL`, '这一波，先集火谁？', '指定对方一名英雄作为优先目标。战术选择与目标定位会共同影响团战结果。', '选择 1 / 5')}${teamStrip()}${waitingBanner()}<div class="target-grid">${enemies.map((unit,index) => { const pick = champion(unit.championId); return `<button class="target-card" data-action="choose-target" data-id="${esc(unit.championId)}" ${isLocked() || view.busy ? 'disabled' : ''}><small>TARGET 0${index + 1}</small>${icon(pick?.icon, pick?.name || unit.name, 'large')}<strong>${esc(pick?.name || unit.name || unit.championId)}</strong><span>${esc((pick?.tags || [unit.role]).map(role).join(' / '))}</span><b>优先集火 ↗</b></button>`; }).join('')}</div></section>`;
}
function tactic() {
  const stage = game.tacticStage || 'engage';
  const options = game.options?.tactics || [];
  const index = ['engage','response','finish'].indexOf(stage);
  const picked = game.you?.tactics || {};
  return `<section class="stage-card">${stageHeading(`ROUND ${game.round} / LIVE TEAMFIGHT`, tacticTitle[stage] || '团战决策', '双方各自选择战术，只有两人都锁定后才进入下一步。选择会影响队伍输出、承伤与击杀机会。', `决策 ${index + 1} / 3`)}<div class="tactic-timeline">${['engage','response','finish'].map((step,position) => `<span class="${position === index ? 'active' : position < index ? 'complete' : ''}"><b>0${position + 1}</b>${tacticTitle[step]}</span>`).join('')}</div>${teamStrip()}${game.you?.targetId ? `<div class="focus-call">本轮优先目标 <b>${esc(heroName(game.you.targetId))}</b></div>` : ''}${waitingBanner()}<div class="tactic-grid">${options.map((option,position) => `<button class="tactic-card" data-action="choose-tactic" data-id="${esc(option.id)}" ${isLocked() || view.busy ? 'disabled' : ''}><small>TACTIC ${String(position + 1).padStart(2,'0')}</small><strong>${esc(option.name)}</strong><p>${esc(option.description)}</p><b>执行战术 ↗</b></button>`).join('')}</div>${Object.keys(picked).length ? `<div class="picked-tactics">已完成：${Object.entries(picked).map(([step,value]) => `<span>${esc(tacticTitle[step])} · ${esc(value?.name || value)}</span>`).join('')}</div>` : ''}</section>`;
}

function winnerText(report) {
  if (!report) return '';
  return Number(report.winner) === currentSeat() ? '这一波，我们赢了' : '这一波，对面更胜一筹';
}
function objective() {
  const report = game.roundReport;
  const options = game.options?.objectives || [];
  return `<section class="stage-card">${stageHeading(`ROUND ${game.round} / AFTERMATH`, '团战结束，下一步做什么？', '推塔能直接逼近胜利，补给与清线能强化后续回合；最后一轮还可以尝试偷塔。', `${fmt(game.you?.gold)} G`)}${report ? `<div class="fight-outcome ${Number(report.winner) === currentSeat() ? 'win' : 'lose'}"><small>TEAMFIGHT RESOLVED</small><strong>${esc(winnerText(report))}</strong><span>双方战术已经结算，战后行动会继续改变塔与经济。</span></div>` : ''}${waitingBanner()}<div class="objective-grid">${options.map((option,index) => `<button class="objective-card" data-action="choose-objective" data-id="${esc(option.id)}" ${isLocked() || view.busy ? 'disabled' : ''}><small>AFTERMATH 0${index + 1}</small><strong>${esc(option.name)}</strong><p>${esc(option.description)}</p><b>选择行动 ↗</b></button>`).join('')}</div></section>`;
}
function report() {
  const report = game.roundReport || {};
  const mine = currentSeat();
  const myTeam = report.teams?.find(entry => Number(entry.seat) === mine) || {};
  const rivalTeam = report.teams?.find(entry => Number(entry.seat) === otherSeat()) || {};
  const objective = report.objectives?.find(entry => Number(entry.seat) === mine);
  const focus = report.focus?.find(entry => Number(entry.seat) === mine);
  const income = report.economy?.find(entry => Number(entry.seat) === mine);
  return `<section class="stage-card">${stageHeading(`ROUND ${report.round || game.round} / BATTLE REPORT`, '这一波，尘埃落定', '查看击杀、经济和推进结果。双方确认战报后自动进入下一回合。', `第 ${fmt(report.round || game.round)} 回合`)}<div class="report-hero ${Number(report.winner) === mine ? 'win' : 'lose'}"><small>${Number(report.winner) === mine ? 'VICTORY' : 'DEFEAT'}</small><strong>${esc(winnerText(report))}</strong><span>${fmt(myTeam.kills)} : ${fmt(rivalTeam.kills)} 击杀 · ${fmt(report.seconds)} 秒团战</span></div><div class="report-metrics"><div><span>你的击杀</span><b>${fmt(myTeam.playerKills)}</b></div><div><span>造成伤害</span><b>${fmt(myTeam.playerDamage)}</b></div><div><span>本轮收入</span><b>+${fmt(income?.total)} G</b></div><div><span>敌方塔</span><b>${fmt(game.towers?.[otherSeat()] ?? 100)}%</b></div></div><div class="report-story"><div><small>集火结果</small><p>${focus ? `${esc(focus.name || heroName(focus.championId))} ${focus.killed ? '被击倒，集火成功。' : '存活，未能完成击杀。'}` : '本轮未记录优先目标。'}</p></div><div><small>战后行动</small><p>${objective ? `${esc(objective.name)} · ${esc(objective.text || '已执行')}` : '双方战后行动已结算。'}</p></div></div>${report.events?.length ? `<div class="event-log"><h3>战况记录</h3><ol>${report.events.map(event => `<li>${esc(event)}</li>`).join('')}</ol></div>` : ''}${waitingBanner()}<div class="stage-action-row"><button class="primary" data-action="ready-report" ${isLocked() || view.busy ? 'disabled' : ''}>确认战报 · 进入下一回合 ↗</button></div></section>`;
}
function finish() {
  const result = game.result || {};
  const win = Number(result.winner) === currentSeat();
  return `<section class="stage-card final-card"><div class="final-halo">✦</div><span class="eyebrow">MATCH COMPLETE / 4 ROUNDS</span><h2>${win ? '这局，胜利属于你。' : '胜负已定，再约下一局。'}</h2><p>${esc(result.reason || '四轮团战与推进结束，服务器已完成最终结算。')}</p><div class="final-score"><span>${esc(game.you?.name || '你')}</span><b>${fmt(game.score?.[currentSeat()])} : ${fmt(game.score?.[otherSeat()])}</b><span>${esc(game.opponent?.name || '对手')}</span></div><div class="final-towers"><span>我方塔 ${fmt(game.towers?.[currentSeat()] ?? 100)}%</span><span>敌方塔 ${fmt(game.towers?.[otherSeat()] ?? 100)}%</span></div>${game.roundReport ? `<div class="final-last">最后一波 · ${esc(winnerText(game.roundReport))}</div>` : ''}<div class="stage-action-row"><button class="primary" data-action="leave-room">返回大厅 · 再开一局 ↗</button><button class="secondary" data-action="copy-link">分享本局链接</button></div></section>`;
}

function stage() {
  if (game.status === 'waiting' || game.phase === 'waiting') return waitingRoom();
  if (game.phase === 'hero') return heroDraft();
  if (game.phase === 'augment') return augmentDraft();
  if (game.phase === 'shop') return shop();
  if (game.phase === 'target') return target();
  if (game.phase === 'tactic') return tactic();
  if (game.phase === 'objective') return objective();
  if (game.phase === 'report') return report();
  if (game.phase === 'finished') return finish();
  return `<section class="stage-card"><h2>正在同步房间</h2><p>服务器当前阶段：${esc(game.phase)}</p></section>`;
}
function sidebar() {
  return `<aside class="duel-aside"><section class="match-panel">${playerMark(game.you, true)}<div class="versus-line">VS</div>${playerMark(game.opponent, false)}${scorePanel()}</section>${game.phase !== 'shop' && game.phase !== 'hero' && game.phase !== 'waiting' ? buildPanel() : ''}<section class="rule-panel"><span class="eyebrow">MATCH RULES</span><h3>同步推进的文字对战</h3><p>每一步由两名玩家分别锁定，服务器统一抽牌、检验金币并计算团战。阶段内尚未锁定的选择只有自己可见。</p><div><span>当前阶段</span><b>${esc(phaseTitle[game.phase] || game.phase)}</b></div><div><span>房间状态</span><b>${game.status === 'waiting' ? '等待好友' : game.status === 'finished' ? '已结束' : '对局中'}</b></div><div><span>数据版本</span><b>${esc(catalog?.meta?.patch || '加载中')}</b></div></section></aside>`;
}
function render() {
  document.title = `${game ? `${phaseTitle[game.phase] || '双人对战'} · ${game.code}` : '双人对战'} · 海斗战记`;
  root.innerHTML = `${header()}${game ? `<main class="duel-shell">${roomRibbon()}${progress()}<div class="duel-layout"><div>${stage()}${notice()}</div>${sidebar()}</div></main>` : landing()}<footer class="duel-footer"><span>海斗战记 · 非官方爱好者文字游戏</span><span>数值、抽选和联机规则均为本站模拟，并非实战胜率。</span><a href="${esc(soloUrl)}">返回单机版 ↗</a></footer>`;
}

root.addEventListener('submit', async event => {
  if (event.target.id !== 'room-form') return;
  event.preventDefault();
  if (view.busy) return;
  const data = new FormData(event.target);
  view.name = String(data.get('name') || '');
  view.roomCode = String(data.get('code') || '').trim().toUpperCase();
  view.busy = true; view.error = '';
  render();
  try { if (event.submitter?.dataset.formAction === 'join') await joinRoom(); else await createRoom(); }
  catch (error) { view.error = briefError(error); }
  finally { view.busy = false; render(); }
});
root.addEventListener('input', event => {
  if (event.target.name === 'name') view.name = event.target.value;
  if (event.target.name === 'code') view.roomCode = event.target.value.toUpperCase();
  if (event.target.matches('[data-shop-search]')) {
    view.search = event.target.value;
    const grid = root.querySelector('#store-grid');
    if (grid) grid.innerHTML = shopItems();
  }
});
root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || !root.contains(button)) return;
  const { action, id } = button.dataset;
  view.notice = '';
  if (action === 'copy-link' && game) { copyText(roomLink(game.code)); return; }
  if (action === 'leave-room') { leaveRoom(); return; }
  if (action === 'shop-filter') { view.filter = id; render(); return; }
  if (!game || view.busy || isLocked()) return;
  const commands = {
    'choose-hero': ['choose_hero', { championId: id }],
    'reroll-augment': ['reroll_augment', {}],
    'choose-augment': ['choose_augment', { augmentId: id }],
    'buy-item': ['buy_item', { itemId: id }],
    'sell-item': ['sell_item', { itemId: id }],
    'ready-shop': ['ready_shop', {}],
    'choose-target': ['choose_target', { championId: id }],
    'choose-tactic': ['choose_tactic', { tacticId: id }],
    'choose-objective': ['choose_objective', { objectiveId: id }],
    'ready-report': ['ready_report', {}],
  };
  if (commands[action]) sendAction(...commands[action]);
});
root.addEventListener('error', event => {
  if (event.target.matches?.('.duel-icon img')) event.target.remove();
}, true);

async function init() {
  root.innerHTML = '<div class="duel-loading">正在连接海斗战场…</div>';
  try {
    catalog = await request(apiPath('catalog'), { cache: 'default' });
    render();
    const requested = view.roomCode;
    const recent = requested || localStorage.getItem(lastRoomKey);
    if (recent && localStorage.getItem(roomTokenKey(recent))) {
      try { await resumeRoom(recent); }
      catch (error) { view.error = `无法恢复房间：${briefError(error)}`; render(); }
    }
  } catch (error) {
    view.error = `联机服务暂不可用：${briefError(error)}`;
    render();
  }
}
init();
