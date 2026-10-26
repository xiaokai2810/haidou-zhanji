import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'squad-http-'));
  const app = await createApp({dataDir});
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base = `http://127.0.0.1:${app.server.address().port}/api/squads`;
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve)); await rm(dataDir,{recursive:true,force:true});});
  async function req(path='',body,token) {
    const res=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    return {...await res.json(),status:res.status};
  }
  return {app,req,dataDir};
}
test('ten humans share exactly ten hero slots, enforce ownership and seal ready phases',async t=>{
  const {req}=await setup(t);
  const host=await req('',{name:'host'});assert.equal(host.status,201);
  const clients=[host];
  for(let i=1;i<10;i++){const p=await req(`/${host.code}/join`,{name:`p${i}`,team:i%2});assert.equal(p.status,200);clients.push(p);}
  assert.equal((await req(`/${host.code}/join`,{team:0})).status,409);
  assert.equal((await req(`/${host.code}`)).status,401);
  const packet=await req(`/${host.code}`,undefined,host.token);
  for(const team of [0,1]) assert.deepEqual(packet.members.filter(p=>p.team===team).flatMap(p=>p.heroIndices).sort(),[0,1,2,3,4]);
  assert.ok(packet.members.every(p=>p.heroIndices.length===1));
  assert.ok(!JSON.stringify(packet.state).includes(host.token));
  assert.equal((await req(`/${host.code}/actions`,{type:'start'},clients[1].token)).status,403);
  await req(`/${host.code}/actions`,{type:'start'},host.token);
  const current=await req(`/${host.code}`,undefined,host.token);
  const foreign=[0,1,2,3,4].find(i=>!current.ownedHeroes.includes(i));
  const call=(client,type,data={})=>req(`/${host.code}/actions`,{type,expectedPhase:'draft',expectedRound:1,...data},client.token);
  assert.equal((await call(host,'auto-hero',{heroIndex:foreign})).status,403);
  assert.equal((await call(host,'ready')).status,409);
  for(const client of clients){assert.equal((await call(client,'auto')).status,200);}
  for(const client of clients){const response=await call(client,'ready');assert.equal(response.status,200);}
  const next=await req(`/${host.code}`,undefined,host.token);
  assert.equal(next.state.phase,'augment');assert.ok(next.members.every(p=>!p.ready));
  assert.equal((await call(host,'ready')).status,409,'stale ready cannot ready the next phase');
});
test('two commanders complete seven waves and persisted room retains ownership and outcome',async t=>{
  const {req,dataDir}=await setup(t);
  const host=await req('',{name:'blue'});
  const rival=await req(`/${host.code}/join`,{name:'red',team:1});
  const clients=[host,rival];
  let p=await req(`/${host.code}/actions`,{type:'start'},host.token);
  let phases=0;
  while(p.state.phase!=='finished' && phases++<45){
    const phase=p.state.phase, round=p.state.round;
    for(const client of clients){
      const data={expectedPhase:phase,expectedRound:round};
      if(['draft','augment','shop','plan'].includes(phase)) {
        const fill=await req(`/${host.code}/actions`,{...data,type:'auto'},client.token);assert.equal(fill.status,200,fill.error);
      }
      if(phase==='aftermath') {
        const objective=await req(`/${host.code}/actions`,{...data,type:'objective',objectiveId:'farm'},client.token);
        // Use the documented engine objective id; invalid actions must not advance.
        if(objective.status!==200){
          const state=await req(`/${host.code}`,undefined,client.token);
          const {OBJECTIVES}=await import('../src/squad-engine.js');
          const id=OBJECTIVES.find(x=>x.id!=='backdoor')?.id;
          assert.equal((await req(`/${host.code}/actions`,{...data,type:'objective',objectiveId:id},client.token)).status,200);
        }
      }
      p=await req(`/${host.code}/actions`,{...data,type:'ready'},client.token);assert.equal(p.status,200,p.error);
    }
  }
  assert.equal(p.state.phase,'finished');assert.equal(p.state.round,7);assert.equal(p.state.history.length,7);
  const restart=await createApp({dataDir});
  const restored=restart.store.get(host.code);
  assert.equal(restored.kind,'squad');assert.equal(restored.game.phase,'finished');assert.equal(restored.members.length,2);
  restart.server.emit('close');
});

test('a captain cannot partially ready aftermath before selecting an objective, and all three players can continue', async t => {
  const {req} = await setup(t);
  const host = await req('', {name: 'captain'});
  const ally = await req(`/${host.code}/join`, {name: 'ally', team: 0});
  const rival = await req(`/${host.code}/join`, {name: 'rival', team: 1});
  const clients = [host, ally, rival];
  let packet = await req(`/${host.code}/actions`, {type: 'start'}, host.token);
  const send = (client, type, phase, extra = {}) => req(`/${host.code}/actions`, {
    type, expectedPhase: phase, expectedRound: 1, ...extra,
  }, client.token);
  for (const phase of ['draft', 'augment', 'shop', 'plan']) {
    assert.equal(packet.state.phase, phase);
    for (const client of clients) {
      const fill = await send(client, 'auto', phase);
      assert.equal(fill.status, 200, fill.error);
      packet = await send(client, 'ready', phase);
      assert.equal(packet.status, 200, packet.error);
    }
  }
  assert.equal(packet.state.phase, 'aftermath');
  const rejected = await send(host, 'ready', 'aftermath');
  assert.equal(rejected.status, 409);
  assert.match(rejected.error, /战后行动/);
  const unchanged = await req(`/${host.code}`, undefined, host.token);
  assert.equal(unchanged.members.find(member => member.id === host.seat).ready, false);
  assert.equal(unchanged.state.teams[0].ready, false);
  assert.equal(unchanged.state.teams[0].objectiveId, null);

  assert.equal((await send(host, 'objective', 'aftermath', {objectiveId: 'farm_wave'})).status, 200);
  assert.equal((await send(host, 'ready', 'aftermath')).status, 200);
  assert.equal((await send(ally, 'ready', 'aftermath')).status, 200);
  assert.equal((await send(rival, 'objective', 'aftermath', {objectiveId: 'defend_tower'})).status, 200);
  packet = await send(rival, 'ready', 'aftermath');
  assert.equal(packet.status, 200, packet.error);
  assert.equal(packet.state.phase, 'report');
  assert.ok(packet.members.every(member => !member.ready));
  assert.equal(packet.state.roundReport.objectives.length, 2);
});

test('unready restores personal editing before the team locks, but cannot reopen a locked team', async t => {
  const {req} = await setup(t);
  const host = await req('', {name: 'captain'});
  const ally = await req(`/${host.code}/join`, {name: 'ally', team: 0});
  await req(`/${host.code}/join`, {name: 'rival', team: 1});
  await req(`/${host.code}/actions`, {type: 'start'}, host.token);
  const send = (client, type) => req(`/${host.code}/actions`, {
    type, expectedPhase: 'draft', expectedRound: 1,
  }, client.token);
  assert.equal((await send(host, 'auto')).status, 200);
  let packet = await send(host, 'ready');
  assert.equal(packet.status, 200);
  assert.equal(packet.members.find(member => member.id === host.seat).ready, true);
  assert.equal(packet.state.teams[0].ready, false);
  assert.equal((await send(host, 'auto')).status, 409);

  packet = await send(host, 'unready');
  assert.equal(packet.status, 200, packet.error);
  assert.equal(packet.members.find(member => member.id === host.seat).ready, false);
  assert.equal(packet.members.find(member => member.id === ally.seat).ready, false);
  assert.equal(packet.state.phase, 'draft');
  assert.equal((await send(host, 'auto')).status, 200, 'personal actions are accepted again');
  assert.equal((await send(host, 'ready')).status, 200);
  assert.equal((await send(ally, 'auto')).status, 200);
  packet = await send(ally, 'ready');
  assert.equal(packet.state.teams[0].ready, true);
  assert.equal(packet.state.teams[1].ready, false);
  assert.equal((await send(host, 'unready')).status, 409);
});
