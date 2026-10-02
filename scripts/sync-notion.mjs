import fs from "node:fs/promises";
import path from "node:path";

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) throw new Error("GitHub Secret NOTION_TOKEN이 없습니다.");
const API = "https://api.notion.com/v1";
const VERSION = "2026-03-11";
const BOOKS_SOURCE = "668551f3-818b-83b2-aa05-07a9d0b5b326";
const REPORT_SOURCE = "7c4551f3-818b-83ac-b622-0784ac9bbebe";
const headers = {Authorization:`Bearer ${TOKEN}`,"Notion-Version":VERSION,"Content-Type":"application/json"};

async function queryAll(id){
  const rows=[]; let cursor;
  do {
    const body={page_size:100}; if(cursor) body.start_cursor=cursor;
    const res=await fetch(`${API}/data_sources/${id}/query`,{method:"POST",headers,body:JSON.stringify(body)});
    if(!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    const json=await res.json(); rows.push(...json.results); cursor=json.has_more?json.next_cursor:null;
  } while(cursor);
  return rows;
}
const plain = arr => (arr||[]).map(x=>x.plain_text||"").join("");
const prop = (page,name) => page.properties?.[name];
const title = p => plain(p?.title);
const authors = p => (p?.multi_select||[]).map(x=>x.name).join(" · ");
const status = p => p?.status?.name || p?.select?.name || "상태 없음";
const tones=["violet","mint","blue","gold","rose","amber","cyan","indigo"];
function imageUrl(page){
  const f=prop(page,"책 표지")?.files?.[0];
  return f?.file?.url || f?.external?.url || page.cover?.file?.url || page.cover?.external?.url || "";
}
function extension(contentType,url){
  const type=(contentType||"").split(";")[0];
  return ({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"})[type] || (url.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i)?.[1]||"jpg").replace("jpeg","jpg");
}
async function saveCover(url,id){
  if(!url) return "";
  try{
    const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}}); if(!res.ok) throw new Error(String(res.status));
    const ext=extension(res.headers.get("content-type"),url),name=`${id.replaceAll("-","")}.${ext}`;
    await fs.writeFile(path.join("assets/covers",name),Buffer.from(await res.arrayBuffer()));
    return `./assets/covers/${name}`;
  }catch(e){ console.warn(`표지 다운로드 실패: ${id}`,e.message); return url; }
}

await fs.mkdir("data",{recursive:true});
await fs.rm("assets/covers",{recursive:true,force:true});
await fs.mkdir("assets/covers",{recursive:true});
const pages=await queryAll(BOOKS_SOURCE);
const books=[];
for(const [i,page] of pages.entries()){
  const name=title(prop(page,"도서명")); if(!name) continue;
  books.push({
    title:name,
    author:authors(prop(page,"저자")) || "저자 미상",
    status:status(prop(page,"상태")),
    rating:prop(page,"평점")?.select?.name || "",
    currentPage:prop(page,"현재 페이지")?.number ?? null,
    totalPage:prop(page,"전체 페이지")?.number ?? null,
    url:page.url,
    cover:await saveCover(imageUrl(page),page.id),
    tone:tones[i%tones.length],
    createdTime:page.created_time
  });
}
books.sort((a,b)=>new Date(b.createdTime)-new Date(a.createdTime));
const report=await queryAll(REPORT_SOURCE);
const goal=report[0] ? (prop(report[0],"올해 목표 권수")?.number || 0) : 0;
await fs.writeFile("data/books.json",JSON.stringify(books,null,2)+"\n");
await fs.writeFile("data/config.json",JSON.stringify({goal,updatedAt:new Date().toISOString()},null,2)+"\n");
console.log(`동기화 완료: ${books.length}권, 완독 목표 ${goal}권`);
