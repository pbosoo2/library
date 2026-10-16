import test from 'node:test';
import assert from 'node:assert/strict';
import { authConfigured, createSession, validSession, sessionCookie, sessionFromCookie } from '../lib/auth.mjs';
import middleware from '../middleware.js';
import login from '../api/login.js';
import logout from '../api/logout.js';
import library from '../api/library.js';
const password='fixture-password-not-used-in-production';
const secret='fixture-secret-which-is-not-used-in-production';
function configure(){process.env.LIBRARY_PASSWORD=password;process.env.SESSION_SECRET=secret}
configure();
const request=(path,cookie='')=>new Request('https://library.vercel.app'+path,{headers:{cookie}});
function response(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this},end(){return this}}}
const baseHeaders={origin:'https://library.vercel.app',host:'library.vercel.app','x-real-ip':'fixture-client'};
test('secure session cookie persists for seven days; tampering, expiry, and rotation rejected',()=>{
 const token=createSession(),cookie=sessionCookie(token);
 assert.ok(validSession(token));assert.ok(validSession(sessionFromCookie(cookie)));
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=None/);assert.match(cookie,/Partitioned/);assert.match(cookie, /; Max-Age=604800$/);
 const issuedAt=Date.now(),fixedToken=createSession(issuedAt);
 assert.equal(validSession(fixedToken,issuedAt+6*24*60*60*1000),true);
 assert.equal(validSession(fixedToken,issuedAt+7*24*60*60*1000),false);
 assert.equal(validSession(token+'x'),false);assert.equal(validSession(createSession(0)),false);
 process.env.SESSION_SECRET=secret+'rotated';assert.equal(validSession(token),false);configure();
 process.env.LIBRARY_PASSWORD=password+'rotated';assert.equal(validSession(token),false);configure();
});
test('middleware blocks pages, API, static data and covers without a session',async()=>{
 for(const path of ['/','/index.html','/data/books.json','/data/config.json','/data/live.json','/assets/covers/book.jpg','/api/library']){
  const res=middleware(request(path));assert.equal(res.status,path.startsWith('/api/')||path.startsWith('/data/')||path.startsWith('/assets/')?401:303);
  assert.match(res.headers.get('cache-control'),/no-store/);
 }
 const loginRes=middleware(request('/login'));assert.equal(loginRes.status,200);assert.ok((await loginRes.text()).includes('name="password"'));
});
test('authenticated requests continue with private no-store headers; direct API also blocked',async()=>{
 const res=middleware(request('/',sessionCookie(createSession())));assert.equal(res.headers.get('x-middleware-next'),'1');assert.equal(res.headers.get('cache-control'),'private, no-store');
 const apiRes=response();await library({method:'GET',headers:{host:'library.vercel.app'}},apiRes);assert.equal(apiRes.code,401);
});
test('missing or weak configuration fails closed',async()=>{
 delete process.env.SESSION_SECRET;assert.equal(authConfigured(),false);assert.equal(middleware(request('/login')).status,503);
 const res=response();await login({method:'POST',headers:baseHeaders,body:{password}},res);assert.equal(res.code,503);
 configure();process.env.LIBRARY_PASSWORD='weak';assert.equal(authConfigured(),false);configure();
});
test('password login is POST-only, CSRF protected, and does not echo passwords',async()=>{
 for(const [method,origin,expected] of [['GET',baseHeaders.origin,405],['POST','https://evil.example',403]]){
  const res=response();await login({method,headers:{...baseHeaders,origin},body:{password}},res);assert.equal(res.code,expected);
 }
 const wrong=response();await login({method:'POST',headers:baseHeaders,body:{password:'wrong-fixture'}},wrong);assert.equal(wrong.headers.Location,'/login?error=invalid');assert.equal(wrong.headers['Set-Cookie'],undefined);
 const right=response();await login({method:'POST',headers:baseHeaders,body:{password}},right);assert.equal(right.code,303);assert.equal(right.headers.Location,'/');assert.ok(validSession(sessionFromCookie(right.headers['Set-Cookie'])));assert.match(right.headers['Set-Cookie'],/; Max-Age=604800$/);assert.ok(!JSON.stringify(right).includes(password));
});
test('logout clears the browser cookie; hostile cross-origin logout rejected',()=>{
 const out=response();logout({method:'POST',headers:baseHeaders},out);assert.match(out.headers['Set-Cookie'],/Max-Age=0/);assert.equal(out.headers.Location,'/login');
 const bad=response();logout({method:'POST',headers:{...baseHeaders,origin:'https://evil.example'}},bad);assert.equal(bad.code,403);
});

test('8-character password accepted; shorter passwords remain blocked',()=>{
 process.env.LIBRARY_PASSWORD='fixture8';assert.equal(authConfigured(),true);
 process.env.LIBRARY_PASSWORD='short7!';assert.equal(authConfigured(),false);configure();
});
test('Notion embedding permitted without disabling authentication',async()=>{
 const res=middleware(request('/login'));const csp=res.headers.get('content-security-policy');
 assert.equal(res.headers.get('x-frame-options'),null);assert.ok(csp.includes('https://*.notion.so'));assert.ok(csp.includes('https://*.notion.com'));assert.ok(csp.includes('https://*.notion.site'));assert.ok(!csp.includes("frame-ancestors 'none'"));
 assert.equal(middleware(request('/api/library')).status,401);
 const signed=middleware(request('/',sessionCookie(createSession())));assert.equal(signed.headers.get('x-frame-options'),null);assert.ok(signed.headers.get('content-security-policy').includes('frame-ancestors'));
});
