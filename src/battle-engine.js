import { clamp, computeBuild } from './model.js';

const ROLE_RULES = [
  { attacker: 'Assassin', defender: 'Mage', bonus: .12, label: '刺客切入法师' },
  { attacker: 'Assassin', defender: 'Marksman', bonus: .12, label: '刺客切入射手' },
  { attacker: 'Tank', defender: 'Assassin', bonus: .10, label: '前排限制刺客' },
  { attacker: 'Marksman', defender: 'Tank', bonus: .10, label: '持续输出压制前排' },
  { attacker: 'Fighter', defender: 'Tank', bonus: .06, label: '战士与前排拉扯' },
];

// Hand-authored mechanic examples, not observed matchup win rates.
const HERO_RULES = [
  { attacker: 'Yasuo', defenderTag: 'Marksman', bonus: .07, label: '亚索风墙限制飞行道具' },
  { attacker: 'Trundle', defenderTag: 'Tank', bonus: .08, label: '特朗德尔大招偷取双抗' },
  { attacker: 'Fiora', defenderTag: 'Tank', bonus: .06, label: '菲奥娜破绽适合持续单挑' },
  { attacker: 'Rammus', defenderTag: 'Marksman', bonus: .08, label: '拉莫斯的护甲与反击机制' },
  { attacker: 'Morgana', defenderTag: 'Tank', bonus: .05, label: '莫甘娜黑盾抵挡控制' },
];

const firstRole = tags => tags.find(tag => ['Marksman', 'Mage', 'Assassin', 'Tank', 'Fighter', 'Support'].includes(tag)) || 'Fighter';
const classWeights = champion => ({
  Marksman: [1.00, .16], Mage: [.26, 1.00], Assassin: [.88, .48],
  Tank: [.55, .42], Fighter: [.84, .40], Support: [.31, .72],
})[firstRole(champion.tags || [])];

function resistFactor(resistance) {
  return resistance >= 0 ? 100 / (100 + resistance) : 2 - 100 / (100 - resistance);
}

export function counterModifier(attacker, defender) {
  const tagsA = attacker.tags || [];
  const tagsD = defender.tags || [];
  const reasons = [];
  let bonus = 0;
  for (const rule of ROLE_RULES) {
    if (tagsA.includes(rule.attacker) && tagsD.includes(rule.defender)) {
      bonus += rule.bonus;
      reasons.push(`${rule.label} +${Math.round(rule.bonus * 100)}%`);
      break;
    }
  }
  for (const rule of HERO_RULES) {
    if (attacker.id === rule.attacker && tagsD.includes(rule.defenderTag)) {
      bonus += rule.bonus;
      reasons.push(`${rule.label} +${Math.round(rule.bonus * 100)}%`);
    }
  }
  return { factor: clamp(1 + bonus, .8, 1.25), reasons };
}

export function makeCombatant({ champion, level, augments = [], items = [], growth = {} }) {
  const panel = computeBuild({ champion, level, augments, items, growth, targetArmor: 0, targetMr: 0 });
  return { champion, level, augments, items, panel };
}

export function damageProfile(attacker, defender) {
  const a = attacker.panel.stats;
  const d = defender.panel.stats;
  const [autoWeight, spellWeight] = classWeights(attacker.champion);
  const armor = Math.max(-50, d.armor * (1 - a.armorPenPct / 100) - a.lethality);
  const mr = Math.max(-50, d.mr * (1 - a.magicPenPct / 100) - a.magicPen);
  const physical = a.ad * a.as * (1 + a.crit / 100 * .75) * autoWeight * resistFactor(armor);
  const magic = (110 + a.ap * .75) * (1 + a.haste / 130) / 3.5 * spellWeight * resistFactor(mr);
  const counter = counterModifier(attacker.champion, defender.champion);
  const factor = counter.factor * attacker.panel.damageMultiplier;
  return {
    physical: physical * factor,
    magic: magic * factor,
    total: (physical + magic) * factor,
    counter,
  };
}

const sustain = (profile, dealtPhysical) => dealtPhysical * clamp(profile.panel.stats.lifesteal / 100, 0, .6) * .35;

export function simulateDuel(left, right) {
  const leftDamage = damageProfile(left, right);
  const rightDamage = damageProfile(right, left);
  const step = .1;
  let hpLeft = left.panel.stats.hp;
  let hpRight = right.panel.stats.hp;
  let seconds = 0;
  while (seconds < 90 && hpLeft > 0 && hpRight > 0) {
    hpLeft = Math.min(left.panel.stats.hp, hpLeft - rightDamage.total * step + sustain(left, leftDamage.physical) * step);
    hpRight = Math.min(right.panel.stats.hp, hpRight - leftDamage.total * step + sustain(right, rightDamage.physical) * step);
    seconds += step;
  }
  const leftRatio = hpLeft / left.panel.stats.hp;
  const rightRatio = hpRight / right.panel.stats.hp;
  const winner = hpLeft <= 0 && hpRight <= 0 ? 'draw'
    : hpLeft <= 0 ? 'right' : hpRight <= 0 ? 'left'
    : Math.abs(leftRatio - rightRatio) < .05 ? 'draw' : leftRatio > rightRatio ? 'left' : 'right';
  return {
    winner, seconds: Math.round(seconds * 10) / 10,
    leftRemaining: Math.max(0, hpLeft), rightRemaining: Math.max(0, hpRight),
    leftDamage, rightDamage,
    modelCoverage: [left.panel.coverage, right.panel.coverage],
  };
}

export function createUnderfedBots(champions, playerLevel, itemCatalog = []) {
  const level = Math.max(1, playerLevel - 4);
  const roleItem = { Marksman: '3046', Mage: '6655', Assassin: '3142', Tank: '3065', Fighter: '3078', Support: '2065' };
  const championItem = { Teemo: '6655' };
  return champions.map(champion => {
    const itemId = championItem[champion.id] || roleItem[firstRole(champion.tags || [])];
    const item = itemCatalog.find(x => x.id === itemId);
    return makeCombatant({ champion, level, items: item ? [item] : [] });
  });
}

export function simulateOneVsFive(player, bots) {
  if (bots.length !== 5 || new Set(bots.map(b => b.champion.id)).size !== 5) {
    throw new Error('请选择五名不同的人机英雄');
  }
  const maxHp = player.panel.stats.hp;
  const botHp = bots.map(bot => bot.panel.stats.hp);
  let playerHp = maxHp;
  let seconds = 0;
  let firstKill = null;
  let totalDealt = 0;
  let totalTaken = 0;
  const ccCount = bots.filter(bot => bot.champion.tags.some(tag => ['Tank', 'Mage', 'Support'].includes(tag))).length;
  const crowdControlFactor = Math.max(.78, 1 - ccCount * .035);
  const splash = player.champion.tags.includes('Mage') ? .18 : player.champion.tags.includes('Fighter') ? .11 : .06;
  const outgoingByBot = bots.map(bot => damageProfile(player, bot));
  const incomingByBot = bots.map(bot => damageProfile(bot, player));
  const teamEfficiency = .42;
  const step = .1;
  while (seconds < 90 && playerHp > 0 && botHp.some(hp => hp > 0)) {
    const alive = botHp.map((hp, i) => hp > 0 ? i : -1).filter(i => i >= 0);
    const target = alive.reduce((best, i) => botHp[i] < botHp[best] ? i : best, alive[0]);
    const outgoing = outgoingByBot[target];
    const focusHit = outgoing.total * crowdControlFactor * step;
    botHp[target] -= focusHit;
    totalDealt += focusHit;
    for (const i of alive) {
      if (i === target) continue;
      const splashHit = outgoingByBot[i].total * splash * crowdControlFactor * step;
      botHp[i] -= splashHit;
      totalDealt += splashHit;
    }
    if (firstKill === null && botHp.some(hp => hp <= 0)) firstKill = seconds + step;
    const incoming = alive.reduce((sum, i) => sum + incomingByBot[i].total, 0) * teamEfficiency * step;
    totalTaken += incoming;
    playerHp = Math.min(maxHp, playerHp - incoming + sustain(player, outgoing.physical) * step);
    seconds += step;
  }
  const defeated = botHp.filter(hp => hp <= 0).length;
  const winner = defeated === 5 && playerHp > 0 ? 'player' : playerHp <= 0 ? 'bots' : 'timeout';
  return {
    winner, seconds: Math.round(seconds * 10) / 10,
    playerRemaining: Math.max(0, playerHp), defeated,
    botRemaining: botHp.map(hp => Math.max(0, hp)),
    totalDealt: Math.round(totalDealt), totalTaken: Math.round(totalTaken),
    firstKill: firstKill === null ? null : Math.round(firstKill * 10) / 10,
    botLevel: bots[0].level, crowdControlFactor, splash, teamEfficiency,
    modelCoverage: player.panel.coverage,
  };
}
