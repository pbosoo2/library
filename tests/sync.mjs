import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLibrary, syncKeys } from '../lib/sync-library.mjs';
import { redisCredentials, createRedis } from '../lib/redis.mjs';
const TOKEN='fixture-notion-token';
const START=Date.parse('2026-10-03T10:00:00Z');
function row(id,title='도서 A',round=1,status='읽기 전') {
  return {id,url:`https://www.notion.so/${id}`,created_time:'2026-01-01T00:00:00Z',last_edited_time:'2026-10-03T09:00:00Z',
    parent:{data_source_id:'668551f3-818b-83b2-aa05-07a9d0b5b326'},
    properties:{'도서명':{title:[{plain_text:title}]},'상태':{status:{name:status}},'회차':{number:round},'저자':{multi_select:[{name:'저자'}]},'비공개 메모':{rich_text:[{plain_text:'PRIVATE DO NOT STORE'}]}}};
}
const report=goal=>({id:'goal',created_time:'2026-01-01T00:00:00Z',properties:{'올해 목표 권수':{number:goal},'비공개 메모':{rich_text:[{plain_text:'PRIVATE DO NOT STORE'}]}}});
function memoryRedis() {
  const values=new Map(),commands=[];
  const redis=async(...args)=>{
    commands.push(args);const [cmd,...a]=args;
    if(cmd==='GET')return values.get(a[0])??null;
    if(cmd==='SET'){if(a.includes('NX')&&values.has(a[0]))return null;values.set(a[0],a[1]);return 'OK'}
    if(cmd==='EVAL'){
      const [,keys,...rest]=a;
      const lock=rest[0],owner=rest[Number(keys)];
      if(values.get(lock)!==owner)return 0;
      if(Number(keys)===2)values.set(rest[1],rest[3]);
      values.delete(lock);return 1;
    }
    throw new Error('Unexpected Redis command');
  };
  return {values,commands,redis};
}
function notion(pages,goals) {
  const calls=[];const fetchImpl=async(url,options={})=>{
    calls.push({url,body:options.body?JSON.parse(options.body):null});
    return Response.json({results:url.includes('668551f3')?pages:goals,has_more:false});
  };return {calls,fetchImpl};
}
test('initial full load then empty deltas keep every existing book and goal',async()=>{
  const db=memoryRedis(),full=notion([row('a'),row('b','도서 B')],[report(10)]);
  const first=await syncLibrary(TOKEN,db.redis,{fetchImpl:full.fetchImpl,now:()=>START});
  assert.equal(first.books.length,2);assert.equal(first.config.goal,10);
  assert.ok(full.calls.every(c=>!c.body.filter));
  assert.ok(!JSON.stringify([...db.values.values()]).includes('PRIVATE DO NOT STORE'));
  const delta=notion([],[]),later=START+3600000;
  const next=await syncLibrary(TOKEN,db.redis,{fetchImpl:delta.fetchImpl,now:()=>later});
  assert.deepEqual(next.books,first.books);assert.equal(next.config.goal,10);
  assert.equal(delta.calls.length,2);
  for(const call of delta.calls)assert.deepEqual(call.body.filter,{timestamp:'last_edited_time',last_edited_time:{on_or_after:new Date(START-120000).toISOString()}});
});
test('delta merges changed/new records, title regrouping, rounds and goal changes',async()=>{
  const db=memoryRedis();await syncLibrary(TOKEN,db.redis,{fetchImpl:notion([row('a'),row('b','도서 B')],[report(10)]).fetchImpl,now:()=>START});
  const delta=notion([row('a','도서 B',2,'완독'),row('c','도서 C')],[report(20)]);
  const next=await syncLibrary(TOKEN,db.redis,{fetchImpl:delta.fetchImpl,now:()=>START+3600000});
  assert.equal(next.books.length,2);assert.equal(next.config.goal,20);
  const grouped=next.books.find(b=>b.title==='도서 B');assert.equal(grouped.rounds.length,2);assert.equal(grouped.status,'완독');
  const blank=row('c','');const removed=await syncLibrary(TOKEN,db.redis,{fetchImpl:notion([blank],[]).fetchImpl,now:()=>START+7200000});
  assert.equal(removed.books.length,1);
});
test('24-hour reconciliation removes deleted/moved pages and advances only on success',async()=>{
  const db=memoryRedis();await syncLibrary(TOKEN,db.redis,{fetchImpl:notion([row('a'),row('b','도서 B')],[report(10)]).fetchImpl,now:()=>START});
  const keys=syncKeys(TOKEN),before=db.values.get(keys.snapshot);
  await assert.rejects(syncLibrary(TOKEN,db.redis,{fetchImpl:async()=>Response.json({error:'failed'},{status:500}),now:()=>START+3600000}));
  assert.equal(db.values.get(keys.snapshot),before);assert.equal(db.values.has(keys.lock),false);
  const full=notion([row('b','도서 B')],[]);
  const next=await syncLibrary(TOKEN,db.redis,{fetchImpl:full.fetchImpl,now:()=>START+86400000});
  assert.equal(next.books.length,1);assert.equal(next.config.goal,0);assert.ok(full.calls.every(c=>!c.body.filter));
});
test('delta paging keeps filter on every page and incomplete result never commits',async()=>{
  const db=memoryRedis();await syncLibrary(TOKEN,db.redis,{fetchImpl:notion([row('a')],[report(10)]).fetchImpl,now:()=>START});
  const calls=[];
  await syncLibrary(TOKEN,db.redis,{now:()=>START+3600000,fetchImpl:async(url,opts)=>{
    const body=JSON.parse(opts.body);calls.push(body);
    return Response.json(url.includes('668551f3')?{results:[row(body.start_cursor?'c':'b',body.start_cursor?'도서 C':'도서 B')],has_more:!body.start_cursor,next_cursor:body.start_cursor?null:'next'}:{results:[],has_more:false});
  }});
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.filter));
  const before=db.values.get(syncKeys(TOKEN).snapshot);
  await assert.rejects(syncLibrary(TOKEN,db.redis,{now:()=>START+7200000,fetchImpl:async()=>Response.json({results:[],has_more:false,request_status:{type:'incomplete'}})}));
  assert.equal(db.values.get(syncKeys(TOKEN).snapshot),before);
});
test('expired signed covers are refreshed without a full query',async()=>{
  const db=memoryRedis(),a=row('a');a.properties['책 표지']={files:[{file:{url:'https://files.example/old',expiry_time:new Date(START+1800000).toISOString()}}]};
  await syncLibrary(TOKEN,db.redis,{fetchImpl:notion([a],[report(10)]).fetchImpl,now:()=>START});
  const calls=[];const fresh=structuredClone(a);fresh.properties['책 표지'].files[0].file={url:'https://files.example/new',expiry_time:new Date(START+7200000).toISOString()};
  const data=await syncLibrary(TOKEN,db.redis,{now:()=>START+3600000,fetchImpl:async(url,opts)=>{calls.push({url,body:opts.body?JSON.parse(opts.body):null});return url.includes('/pages/')?Response.json(fresh):Response.json({results:[],has_more:false})}});
  assert.equal(data.books[0].cover,'https://files.example/new');assert.equal(calls.length,3);assert.ok(calls.filter(c=>c.body).every(c=>c.body.filter));
});
test('Redis supports KV and UPSTASH names and rejects read-only-only credentials',async()=>{
  assert.deepEqual(redisCredentials({KV_REST_API_URL:'https://redis.example/',KV_REST_API_TOKEN:'fixture'}),{url:'https://redis.example',token:'fixture'});
  assert.ok(redisCredentials({UPSTASH_REDIS_REST_URL:'https://redis.example',UPSTASH_REDIS_REST_TOKEN:'fixture'}));
  assert.equal(redisCredentials({KV_REST_API_URL:'https://redis.example',KV_REST_API_READ_ONLY_TOKEN:'fixture'}),null);
  let received;const redis=createRedis({url:'https://redis.example',token:'fixture'},async(url,opts)=>{received={url,opts};return Response.json({result:'OK'})});
  assert.equal(await redis('SET','key','value','NX','PX',60000),'OK');assert.deepEqual(JSON.parse(received.opts.body),['SET','key','value','NX','PX',60000]);
  await assert.rejects(createRedis({url:'https://redis.example',token:'fixture'},async()=>Response.json({error:'sensitive detail'}))('GET','key'),e=>!e.message.includes('sensitive'));
});
test('lost lock cannot overwrite a newer snapshot',async()=>{
  const db=memoryRedis(),keys=syncKeys(TOKEN);
  await assert.rejects(syncLibrary(TOKEN,db.redis,{now:()=>START,fetchImpl:async(url)=>{
    db.values.set(keys.lock,'new-owner');return Response.json({results:url.includes('668551f3')?[row('a')]:[report(10)],has_more:false});
  }}),/lock expired/);
  assert.equal(db.values.has(keys.snapshot),false);assert.equal(db.values.get(keys.lock),'new-owner');
});
test('concurrent instance waits for committed data without rereading Notion',async()=>{
  const db=memoryRedis(),keys=syncKeys(TOKEN);
  await syncLibrary(TOKEN,db.redis,{fetchImpl:notion([row('a')],[report(10)]).fetchImpl,now:()=>START});
  db.values.set(keys.lock,'other-worker');let waits=0,notionReads=0;
  const data=await syncLibrary(TOKEN,db.redis,{now:()=>START+3600000,fetchImpl:async()=>{notionReads++;throw new Error('Must not read')},sleep:async()=>{
    waits++;const snapshot=JSON.parse(db.values.get(keys.snapshot));snapshot.syncedAt=new Date(START+3600001).toISOString();db.values.set(keys.snapshot,JSON.stringify(snapshot));db.values.delete(keys.lock);
  }});
  assert.equal(data.books.length,1);assert.equal(waits,1);assert.equal(notionReads,0);
});
