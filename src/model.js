export const GROWTH = {
  phenomenal_evil: { unit: '层', label: '赛末叠层', stat: 'ap', per: 1, type: 'augment', note: '每次技能伤害永久获得 1 法强；若作为第二个强化符文，额外获得 40 法强。' },
  infinite_recursion: { unit: '次', label: '赛末参与击杀', stat: 'haste', per: 3, type: 'augment', note: '基础 60 技能急速，每次参与击杀额外获得 3。' },
  '3084': { unit: '生命值', label: '赛末额外生命值', stat: 'hp', per: 1, type: 'item', note: '请填入心之钢被动在赛末累计的额外生命值。' },
  '126697': { unit: '攻击力', label: '赛末被动攻击力', stat: 'ad', per: 1, type: 'item', note: '请填入狂妄被动在赛末累计的额外攻击力。' },
  '6657': { unit: '层', label: '赛末成长层数', stat: 'roa', per: 1, type: 'item', note: '时光之杖每层提供生命值、法力值和法强；默认按 0 层计算。' },
};

const AUGMENT_EFFECTS = {
  draw_your_sword: { hpPct: .24, adPct: .24, asPct: .20, movePct: .20, lifesteal: .20, note: '近战转换及百分比属性；实际远程系数可能因英雄而异。' },
  blunt_force: { adPct: .20 },
  witchful_thinking: { apByLevel: [20, 80], note: '26.21 为随等级增长的 20–80 法强；文字模拟按 1–18 级线性折算。' },
  goliath: { hpPct: .35, adaptivePct: .15 },
  celestial_body: { hp: 1500, damagePct: -.10 },
  deft: { asPct: .60 },
  recursion: { haste: 60 },
  infinite_recursion: { haste: 60 },
};

export const fmt = (n, digits = 0) => Number.isFinite(n) ? n.toLocaleString('zh-CN', {maximumFractionDigits: digits, minimumFractionDigits: digits}) : '—';
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function averageRecords(records) {
  const buckets = new Map();
  for (const row of records) {
    const id = String(row.id || '').trim();
    const value = Number(row.final_value);
    if (!id || !Number.isFinite(value) || value < 0) continue;
    const b = buckets.get(id) || { sum: 0, count: 0 };
    b.sum += value; b.count += 1; buckets.set(id, b);
  }
  return Object.fromEntries([...buckets].map(([id, v]) => [id, { average: v.sum / v.count, count: v.count }]));
}

function itemBonus(item) {
  const s = item.stats || {}, x = item.extras || {};
  return {
    hp: s.FlatHPPoolMod || 0, mp: s.FlatMPPoolMod || 0,
    ad: s.FlatPhysicalDamageMod || 0, ap: s.FlatMagicDamageMod || 0,
    armor: s.FlatArmorMod || 0, mr: s.FlatSpellBlockMod || 0,
    asPct: s.PercentAttackSpeedMod || 0,
    crit: (s.FlatCritChanceMod || s.PercentCritChanceMod || 0) * 100 || x.critPct || 0,
    lifesteal: (s.PercentLifeStealMod || 0) * 100,
    haste: x.haste || 0, lethality: x.lethality || 0,
    magicPen: x.magicPen || 0, armorPenPct: x.armorPenPct || 0,
    magicPenPct: x.magicPenPct || 0,
    moveFlat: s.FlatMovementSpeedMod || x.moveFlat || 0,
    movePct: s.PercentMovementSpeedMod || 0,
  };
}

export function computeBuild({ champion, level, augments, items, growth = {}, targetArmor = 100, targetMr = 100 }) {
  if (!champion) return null;
  const c = champion.stats;
  const lv = clamp(Number(level) || 1, 1, 18);
  const factor = .7025 * (lv - 1) + .0175 * (lv - 1) ** 2;
  const base = {
    hp: c.hp + c.hpperlevel * factor,
    mp: c.mp + c.mpperlevel * factor,
    ad: c.attackdamage + c.attackdamageperlevel * factor,
    ap: 0,
    armor: c.armor + c.armorperlevel * factor,
    mr: c.spellblock + c.spellblockperlevel * factor,
    as: c.attackspeed * (1 + c.attackspeedperlevel / 100 * factor),
    move: c.movespeed,
    crit: 0, haste: 0, lifesteal: 0,
    lethality: 0, magicPen: 0, armorPenPct: 0, magicPenPct: 0,
  };
  const flat = { hp: 0, mp: 0, ad: 0, ap: 0, armor: 0, mr: 0, asPct: 0, crit: 0, haste: 0, lifesteal: 0, lethality: 0, magicPen: 0, armorPenPct: 0, magicPenPct: 0, moveFlat: 0, movePct: 0 };
  const notes = [];
  for (const item of items) {
    const bonus = itemBonus(item);
    for (const [key, val] of Object.entries(bonus)) flat[key] += val;
  }
  const itemIds = new Set(items.map(i => i.id));
  const growthValue = id => Math.max(0, Number(growth[id]) || 0);
  if (itemIds.has('3084')) flat.hp += growthValue('3084');
  if (itemIds.has('126697')) flat.ad += growthValue('126697');
  if (itemIds.has('6657')) {
    const stacks = Math.min(10, growthValue('6657'));
    flat.hp += stacks * 10; flat.mp += stacks * 30; flat.ap += stacks * 3;
    notes.push('时光之杖按 26.21 每层 10 生命值、30 法力值、3 法强计算，最多 10 层；额外等级由战役阶段规则处理。');
  }
  if (itemIds.has('3042')) flat.ad += .02 * (base.mp + flat.mp);
  let hpPct = 0, adPct = 0, asPct = 0, movePct = 0, hasteFromAP = 0, damagePct = 0, adaptivePct = 0;
  let modeledAugments = 0;
  for (const [index, augment] of augments.entries()) {
    const effect = AUGMENT_EFFECTS[augment.id];
    if (effect) {
      modeledAugments++;
      hpPct += effect.hpPct || 0; adPct += effect.adPct || 0;
      asPct += effect.asPct || 0; movePct += effect.movePct || 0;
      flat.ap += effect.ap || 0;
      if (effect.apByLevel) flat.ap += effect.apByLevel[0] + (effect.apByLevel[1] - effect.apByLevel[0]) * (lv - 1) / 17;
      flat.haste += effect.haste || 0;
      flat.hp += effect.hp || 0;
      damagePct += effect.damagePct || 0; adaptivePct += effect.adaptivePct || 0;
      flat.lifesteal += (effect.lifesteal || 0) * 100;
      hasteFromAP += effect.hasteFromAP || 0;
      if (effect.note) notes.push(`${augment.name}：${effect.note}`);
    }
    if (augment.id === 'phenomenal_evil') {
      modeledAugments++;
      flat.ap += growthValue(augment.id) + (index === 1 ? 40 : 0);
    }
    if (augment.id === 'infinite_recursion') flat.haste += 3 * growthValue(augment.id);
  }
  const result = {
    hp: (base.hp + flat.hp) * (1 + hpPct),
    mp: base.mp + flat.mp,
    ad: (base.ad + flat.ad) * (1 + adPct),
    ap: base.ap + flat.ap,
    armor: base.armor + flat.armor,
    mr: base.mr + flat.mr,
    as: Math.min(2.5, base.as * (1 + flat.asPct + asPct)),
    move: (base.move + flat.moveFlat) * (1 + flat.movePct + movePct),
    crit: Math.min(100, flat.crit),
    haste: flat.haste,
    lifesteal: flat.lifesteal,
    lethality: flat.lethality,
    magicPen: flat.magicPen,
    armorPenPct: flat.armorPenPct,
    magicPenPct: flat.magicPenPct,
  };
  if (adaptivePct) {
    if (result.ap >= result.ad) result.ap *= 1 + adaptivePct;
    else result.ad *= 1 + adaptivePct;
  }
  if (itemIds.has('3089')) result.ap *= 1.30;
  if (itemIds.has('2501')) result.ad += Math.max(0, result.hp - base.hp) * .025;
  if (itemIds.has('4633')) result.ap += Math.max(0, result.hp - base.hp) * .02;
  result.haste += result.ap * hasteFromAP;
  const effectiveArmor = Math.max(-50, targetArmor * (1 - result.armorPenPct / 100) - result.lethality);
  const effectiveMr = Math.max(-50, targetMr * (1 - result.magicPenPct / 100) - result.magicPen);
  const resistanceMultiplier = r => r >= 0 ? 100 / (100 + r) : 2 - 100 / (100 - r);
  const physicalDps = result.ad * result.as * (1 + result.crit / 100 * .75) * resistanceMultiplier(effectiveArmor) * (1 + damagePct);
  const magicBurst = (200 + result.ap * .7) * resistanceMultiplier(effectiveMr) * (1 + damagePct);
  const effectiveHpPhysical = result.hp * (1 + Math.max(0, result.armor) / 100);
  const effectiveHpMagic = result.hp * (1 + Math.max(0, result.mr) / 100);
  const offense = clamp(Math.round(25 + physicalDps / 7 + magicBurst / 23 + result.haste / 8), 0, 100);
  const defense = clamp(Math.round(15 + (effectiveHpPhysical + effectiveHpMagic) / 180), 0, 100);
  const utility = clamp(Math.round(25 + result.move / 15 + result.haste / 5 + result.lifesteal / 3), 0, 100);
  const coverage = augments.length ? modeledAugments / augments.length : 1;
  const weights = champion.tags.includes('Tank') ? [.25, .55, .20]
    : champion.tags.includes('Marksman') || champion.tags.includes('Mage') ? [.58, .22, .20]
    : champion.tags.includes('Support') ? [.30, .45, .25]
    : [.44, .38, .18];
  const score = Math.round(weights[0] * offense + weights[1] * defense + weights[2] * utility);
  const grade = score >= 85 ? 'S' : score >= 72 ? 'A' : score >= 58 ? 'B' : score >= 44 ? 'C' : 'D';
  return { base, stats: result, damageMultiplier: 1 + damagePct, physicalDps, magicBurst, effectiveHpPhysical, effectiveHpMagic, offense, defense, utility, score, grade, coverage, modeledAugments, notes, targetArmor, targetMr };
}
