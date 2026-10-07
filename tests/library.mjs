import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLibrary, readLibrary } from '../lib/library.mjs';
import handler from '../api/library.js';
const book=(id,round,state,date=null)=>({id,url:`https://www.notion.so/${id}`,created_time:`2026-01-0${round}T00:00:00Z`,last_edited_time:'2026-01-05T00:00:00Z',properties:{'도서명':{title:[{plain_text:'인비인'}]},'저자':{multi_select:[{name:'성해나'}]},'상태':{status:{name:state}},'회차':{number:round},'완독일':{date:date?{start:date}:null},'책 표지':{files:[{external:{url:'https://example.com/book.jpg'}}]},'비공개 메모':{rich_text:[{plain_text:'NEVER EXPOSE'}]}}});
const pages=[book('round-two',2,'읽는 중'),book('round-one',1,'완독','2026-01-03')];
const report=[{properties:{'올해 목표 권수':{number:10}}}];
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
function response(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this},end(){return this}}}
test('endpoint rejects writes, unknown origins, and missing server credentials',async()=>{
 delete process.env.NOTION_TOKEN;
 for(const [req,code,error] of [[{method:'POST',headers:{}},405,'read_only'],[{method:'GET',headers:{origin:'https://untrusted.example',host:'site.vercel.app'}},403,'origin_not_allowed'],[{method:'GET',headers:{}},503,'server_not_configured']]){
  const res=response();await handler(req,res);assert.equal(res.code,code);assert.equal(res.body.error,error);assert.equal(res.headers['Cache-Control'],'no-store');
 }
});
test('GET uses server-held credential, caches reads, and returns only projected fields',async()=>{
 const original=globalThis.fetch;
 process.env.NOTION_TOKEN='test-placeholder-not-a-real-token';let calls=0;
 globalThis.fetch=async url=>{calls++;return Response.json({results:url.includes('668551f3')?pages:report,has_more:false})};
 try{
  for(let i=0;i<2;i++){const res=response();await handler({method:'GET',headers:{origin:'https://pbosoo2.github.io'}},res);assert.equal(res.code,200);assert.equal(res.body.books.length,1);assert.ok(!JSON.stringify(res.body).includes(process.env.NOTION_TOKEN));}
  assert.equal(calls,2);
 }finally{globalThis.fetch=original;delete process.env.NOTION_TOKEN}
});
