import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createSquad, actSquad, autoTeam, autoHero, viewSquad } from '../src/squad-engine.js';

const copy = value => JSON.parse(JSON.stringify(value));
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
export const hashToken = token => createHash('sha256').update(token).digest('hex');
const nameOf = value => (typeof value === 'string' ? value.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) : '') || '召唤师';
const phaseKey = game => `${game.round}:${game.phase}`;
export function createSquadRoom(code, name, token, db, now) {
  return { version: 1, kind: 'squad', code, createdAt: now, updatedAt: now, status: 'waiting', revision: 1,
    members: [{ id: '0', name: nameOf(name), team: 0, heroIndices: [0,1,2,3,4], tokenHash: hashToken(token), ready: false }],
    aiTeams: [], game: createSquad({ db, seed: randomBytes(4).readUInt32LE(0) }) };
}
export function authorizeSquad(room, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) fail('缺少房间凭证', 401);
  const hash = Buffer.from(hashToken(token), 'hex');
  const member = room.members.find(person => timingSafeEqual(Buffer.from(person.tokenHash, 'hex'), hash));
  if (!member) fail('房间凭证无效', 401);
  return member;
}
export function joinSquadRoom(room, body, token, now) {
  if (room.status !== 'waiting') fail('对局已经开始，无法加入');
  const next = copy(room);
  const counts = [0,1].map(team => next.members.filter(member => member.team === team).length);
  const team = body.team === undefined ? (counts[1] <= counts[0] ? 1 : 0) : body.team;
  if (![0,1].includes(team)) fail('请选择蓝队或红队', 400);
  if (counts[team] >= 5) fail('这支队伍已满五人');
  const donors = next.members.filter(member => member.team === team).sort((a,b) => b.heroIndices.length - a.heroIndices.length);
  const owned = donors.length ? [donors[0].heroIndices.pop()] : [0,1,2,3,4];
  next.members.push({ id: String(next.members.length), name: nameOf(body.name), team, heroIndices: owned, tokenHash: hashToken(token), ready: false });
  next.updatedAt = now; next.revision++;
  return next;
}
function runAi(room, db) {
  for (const team of room.aiTeams) if (room.game.phase !== 'finished' && !room.game.teams[team].ready) room.game = autoTeam(room.game, team, db);
}
export function actSquadRoom(room, memberId, body, db, now) {
  const next = copy(room);
  const member = next.members.find(person => person.id === memberId);
  const teamMembers = next.members.filter(person => person.team === member.team);
  const captain = teamMembers[0].id === member.id;
  if (body.type === 'start') {
    if (member.id !== '0') fail('只有房主可以开始', 403);
    if (next.status !== 'waiting') fail('对局已经开始');
    if (!next.members.some(person => person.team === 1)) {
      if (!body.fillAi) fail('等待红队加入，或选择挑战人机');
      next.aiTeams = [1];
    }
    next.status = 'playing'; runAi(next, db);
  } else if (body.type === 'claim') {
    if (next.status !== 'waiting') fail('开局后不能调整英雄席位');
    if (!Number.isInteger(body.heroIndex) || body.heroIndex < 0 || body.heroIndex > 4) fail('英雄席位无效', 400);
    const owner = teamMembers.find(person => person.heroIndices.includes(body.heroIndex));
    if (!owner || owner.id === member.id) fail('你已拥有这个席位');
    if (owner.heroIndices.length < 2) fail('每名玩家至少保留一个英雄');
    owner.heroIndices = owner.heroIndices.filter(index => index !== body.heroIndex);
    member.heroIndices.push(body.heroIndex); member.heroIndices.sort();
  } else {
    if (next.status !== 'playing') fail('对局尚未开始或已结束');
    if (body.expectedPhase !== next.game.phase || body.expectedRound !== next.game.round) fail('阶段已更新，请同步后重试');
    const before = phaseKey(next.game);
    if (body.type === 'unready') {
      if (next.game.teams[member.team].ready) fail('全队已锁定，请等待对手');
      member.ready = false;
    } else {
      if (member.ready) fail('你已锁定，请等待队友或取消准备');
      if (body.type === 'ready') {
        if (next.game.phase === 'aftermath' && !next.game.teams[member.team].objectiveId) fail('请先由队长选择战后行动');
        // Validate the caller's complete roster before acknowledging readiness.
        for (const index of member.heroIndices) {
          const hero = next.game.teams[member.team].heroes[index];
          if (next.game.phase === 'draft' && !hero.championId) fail('请先为负责的所有席位选择英雄');
          if (next.game.phase === 'augment' && hero.augmentOffers?.length) fail('请先完成负责英雄的海克斯选择');
        }
        member.ready = true;
        if (teamMembers.every(person => person.ready)) next.game = actSquad(next.game, { team: member.team, type: 'ready' }, db);
      } else if (body.type === 'objective') {
        if (!captain) fail('战后行动由队长选择', 403);
        next.game = actSquad(next.game, { team: member.team, type: 'objective', objectiveId: body.objectiveId }, db);
      } else if (body.type === 'auto') {
        for (const heroIndex of member.heroIndices) next.game = autoHero(next.game, member.team, heroIndex, db);
      } else {
        if (!member.heroIndices.includes(body.heroIndex)) fail('只能操作自己负责的英雄', 403);
        next.game = actSquad(next.game, { ...body, team: member.team }, db);
      }
    }
    runAi(next, db);
    if (phaseKey(next.game) !== before) next.members.forEach(person => { person.ready = false; });
    if (next.game.phase === 'finished') next.status = 'finished';
  }
  next.updatedAt = now; next.revision++;
  return next;
}
export function squadPacket(room, memberId) {
  const member = room.members.find(person => person.id === memberId);
  return { code: room.code, seat: member.id, team: member.team, revision: room.revision, status: room.status,
    host: member.id === '0', captain: room.members.find(person => person.team === member.team).id === member.id,
    ownedHeroes: [...member.heroIndices], aiTeams: [...room.aiTeams],
    members: room.members.map(({id,name,team,heroIndices,ready}) => ({id,name,team,heroIndices:[...heroIndices],ready})),
    state: viewSquad(room.game, member.team) };
}
