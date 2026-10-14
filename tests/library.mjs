import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLibrary, readLibrary } from '../lib/library.mjs';
import handler from '../api/library.js';
import { createSession, sessionCookie } from '../lib/auth.mjs';
process.env.LIBRARY_PASSWORD='fixture-password-not-used-in-production';
process.env.SESSION_SECRET='fixture-secret-which-is-not-used-in-production';
const authHeaders=()=>({host:'library.vercel.app',cookie:sessionCookie(createSession())});
const book=(id,round,state,date=null)=>({id,url:`https://www.notion.so/${id}`,created_time:`2026-01-0${round}T00:00:00Z`,last_edited_time:'2026-01-05T00:00:00Z',properties:{'도서명':{title:[{plain_text:'인비인'}]},'저자':{multi_select:[{name:'성해나'}]},'상태':{status:{name:state}},'회차':{number:round},'완독일':{date:date?{start:date}:null},'책 표지':{files:[{external:{url:'https://example.com/book.jpg'}}]},'비공개 메모':{rich_text:[{plain_text:'NEVER EXPOSE'}]}}});
const pages=[book('round-two',2,'읽는 중'),book('round-one',1,'완독','2026-01-03')];
const report=[{id:'goal',properties:{'올해 목표 권수':{number:10}}}];
test('groups rounds and preserves completion basis without exposing raw properties',()=>{
 const data=projectLibrary(pages,report);
 assert.equal(data.books.length,1);assert.equal(data.books[0].round,2);
 assert.equal(data.books[0].status,'읽는 중');assert.equal(data.books[0].rounds[0].completionBasisDate,'2026-01-03');
 assert.equal(data.config.goal,10);assert.ok(!JSON.stringify(data).includes('NEVER EXPOSE'));
});
test('fixed sources, pagination, and read-only query method',async()=>{
 const calls=[];
 const mock=async(url,options)=>{calls.push([url,options]);const body=JSON.parse(options.body);const isBook=url.includes('668551f3');return Response.json(isBook?{results:body.start_cursor?[pages[1]]:[pages[0]],has_more:!body.start_cursor,next_cursor:body.start_cursor?null:'cursor'}:{results:report,has_more:false});};
 const data=await readLibrary('test-placeholder-not-a-real-token',mock);
 assert.equal(calls.length,3);assert.equal(data.books[0].rounds.length,2);
 assert.ok(calls.every(([url,options])=>url.startsWith('https://api.notion.com/v1/data_sources/')&&options.method==='POST'));
});
function response(){return {headers:authHeaders(),code:200,setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this},end(){return this}}}
test('endpoint rejects writes, unknown origins, and missing server credentials',async()=>{
 delete process.env.NOTION_TOKEN;
 for(const [req,code,error] of [[{method:'POST',headers:authHeaders()},405,'read_only'],[{method:'GET',headers:{...authHeaders(),origin:'https://untrusted.example'}},403,'origin_not_allowed'],[{method:'GET',headers:authHeaders()},503,'server_not_configured']]){
  const res=response();await handler(req,res);assert.equal(res.code,code);assert.equal(res.body.error,error);assert.equal(res.headers['Cache-Control'],'no-store');
 }
});
test('GET syncs through server-held Redis credentials; simultaneous requests coalesce',async()=>{
 const original=globalThis.fetch;
 process.env.NOTION_TOKEN='test-placeholder-not-a-real-token';
 process.env.KV_REST_API_URL='https://redis.example';process.env.KV_REST_API_TOKEN='fixture-redis-token';
 const store=new Map();let notionCalls=0,commands=0;const notionBodies=[];
 globalThis.fetch=async(url,options)=>{
  if(url==='https://redis.example'){
   commands++;const [cmd,...a]=JSON.parse(options.body);let result;
   if(cmd==='SET'){if(a.includes('NX')&&store.has(a[0]))result=null;else{store.set(a[0],a[1]);result='OK'}}
   else if(cmd==='GET')result=store.get(a[0])??null;
   else if(cmd==='EVAL'){const [,keyCount,...rest]=a;if(store.get(rest[0])===rest[keyCount]){if(keyCount===2)store.set(rest[1],rest[3]);store.delete(rest[0]);result=1}else result=0}
   return Response.json({result});
  }
  notionCalls++;notionBodies.push(JSON.parse(options.body));return Response.json({results:url.includes('668551f3')?pages:report,has_more:false});
 };
 try{
  const results=await Promise.all([0,1].map(async()=>{const res=response();await handler({method:'GET',headers:{...authHeaders(),origin:'https://library.vercel.app'}},res);return res}));
  for(const res of results){assert.equal(res.code,200);assert.equal(res.body.books.length,1);assert.ok(!JSON.stringify(res.body).includes(process.env.NOTION_TOKEN));assert.ok(!JSON.stringify(res.body).includes(process.env.KV_REST_API_TOKEN));}
  assert.equal(notionCalls,2);assert.equal(commands,3);
  const res=response();await handler({method:'GET',headers:authHeaders()},res);assert.equal(res.code,200);assert.equal(notionCalls,4);assert.ok(notionBodies.slice(2).every(body=>body.filter));
  const full=response();await handler({method:'GET',url:'/api/library?full=1',headers:authHeaders()},full);assert.equal(full.code,200);assert.equal(notionCalls,6);assert.ok(notionBodies.slice(4).every(body=>!body.filter));assert.ok(full.body.config.fullUpdatedAt);
  delete process.env.KV_REST_API_TOKEN;const missing=response();await handler({method:'GET',headers:authHeaders()},missing);assert.equal(missing.code,503);assert.equal(missing.body.error,'redis_not_configured');
 }finally{globalThis.fetch=original;delete process.env.NOTION_TOKEN;delete process.env.KV_REST_API_URL;delete process.env.KV_REST_API_TOKEN}
});
