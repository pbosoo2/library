// Read-only projection of the existing public library; never returns raw Notion pages.
const API = "https://api.notion.com/v1";
const VERSION = "2026-03-11";
const BOOKS_SOURCE = "668551f3-818b-83b2-aa05-07a9d0b5b326";
const REPORT_SOURCE = "7c4551f3-818b-83ac-b622-0784ac9bbebe";
async function queryAll(id, token, fetchImpl) {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetchImpl(`${API}/data_sources/${id}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
      });
      if (res.status !== 429 || attempt === 1) break;
      const seconds = Math.min(3, Math.max(1, Number(res.headers.get("retry-after")) || 1));
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    if (!res.ok) throw new Error(`Notion API status ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.results)) throw new Error("Invalid Notion response");
    rows.push(...json.results);
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return rows;
}
const plain = arr => (arr||[]).map(x=>x.plain_text||"").join("");
const prop = (page,name) => page.properties?.[name];
const title = p => plain(p?.title);
const authors = p => (p?.multi_select||[]).map(x=>x.name).join(" · ");
const status = p => p?.status?.name || p?.select?.name || "상태 없음";
const date = p => p?.date?.start || null;
const tones=["violet","mint","blue","gold","rose","amber","cyan","indigo"];
function imageUrl(page){
  const f=prop(page,"책 표지")?.files?.[0];
  return f?.file?.url || f?.external?.url || page.cover?.file?.url || page.cover?.external?.url || "";
}

export function projectLibrary(pages, report) {
const records=[];
for(const page of pages){
  const name=title(prop(page,"도서명")); if(!name) continue;
  records.push({
    id:page.id,
    title:name,
    author:authors(prop(page,"저자")) || "저자 미상",
    status:status(prop(page,"상태")),
    round:Math.max(1,prop(page,"회차")?.number || 1),
    startedDate:date(prop(page,"시작일")),
    completedDate:date(prop(page,"완독일")),
    rating:prop(page,"평점")?.select?.name || "",
    currentPage:prop(page,"현재 페이지")?.number ?? null,
    totalPage:prop(page,"전체 페이지")?.number ?? null,
    url:page.url,
    coverSource:imageUrl(page),
    createdTime:page.created_time,
    lastEditedTime:page.last_edited_time
  });
}
const groups=new Map();
for(const record of records){
  const key=record.title.trim().toLocaleLowerCase("ko-KR");
  if(!groups.has(key)) groups.set(key,[]);
  groups.get(key).push(record);
}
const books=[];
for(const [i,rounds] of [...groups.values()].entries()){
  rounds.sort((a,b)=>a.round-b.round || new Date(a.createdTime)-new Date(b.createdTime));
  const latest=rounds.at(-1);
  const coverRecord=[...rounds].reverse().find(item=>item.coverSource) || latest;
  books.push({
    title:latest.title,
    author:latest.author,
    status:latest.status,
    round:latest.round,
    rating:latest.rating,
    currentPage:latest.currentPage,
    totalPage:latest.totalPage,
    url:latest.url,
    cover:coverRecord.coverSource,
    tone:tones[i%tones.length],
    createdTime:latest.createdTime,
    rounds:rounds.map((item,index)=>({
      round:item.round,
      status:item.status,
      startedDate:item.startedDate,
      completedDate:item.completedDate,
      completionBasisDate:item.status==="완독"
        ? (item.completedDate || rounds[index+1]?.createdTime || item.lastEditedTime || item.createdTime)
        : null,
      rating:item.rating,
      url:item.url,
      createdTime:item.createdTime
    }))
  });
}
books.sort((a,b)=>new Date(b.createdTime)-new Date(a.createdTime));
const goal = report[0] ? (prop(report[0], "올해 목표 권수")?.number || 0) : 0;
  return { books, config: { goal } };
}
export async function readLibrary(token, fetchImpl = fetch) {
  const [pages, report] = await Promise.all([
    queryAll(BOOKS_SOURCE, token, fetchImpl), queryAll(REPORT_SOURCE, token, fetchImpl)
  ]);
  const payload = projectLibrary(pages, report);
  payload.config.updatedAt = new Date().toISOString();
  return payload;
}
