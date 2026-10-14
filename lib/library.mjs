// Read-only projection of the existing library; never returns raw Notion pages.
const API = "https://api.notion.com/v1";
const VERSION = "2026-03-11";
export const BOOKS_SOURCE = "668551f3-818b-83b2-aa05-07a9d0b5b326";
export const REPORT_SOURCE = "7c4551f3-818b-83ac-b622-0784ac9bbebe";
export async function queryAll(id, token, fetchImpl, since = null, deadline = Date.now() + 20000) {
  const rows = [];
  let cursor;
  do {
    if (Date.now() >= deadline) throw new Error("Notion query deadline exceeded");
    const body = { page_size: 100, sorts: [{ timestamp: "created_time", direction: "ascending" }] };
    if (since) body.filter = { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } };
    if (cursor) body.start_cursor = cursor;
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetchImpl(`${API}/data_sources/${id}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - Date.now())))
      });
      if (res.status !== 429 || attempt === 1) break;
      const seconds = Math.min(3, Math.max(1, Number(res.headers.get("retry-after")) || 1));
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    if (!res.ok) throw new Error(`Notion API status ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.results)) throw new Error("Invalid Notion response");
    if (json.request_status?.type === "incomplete") throw new Error("Incomplete Notion query");
    if (json.has_more && (!json.next_cursor || json.next_cursor === cursor)) throw new Error("Invalid Notion cursor");
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

export function projectBookRecord(page) {
  const name=title(prop(page,"도서명"));
  if(!name || page.archived || page.in_trash) return null;
  const f=prop(page,"책 표지")?.files?.[0];
  const coverFile=f?.file || (!f?.external ? page.cover?.file : null);
  return {
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
    coverExpiresAt:coverFile?.expiry_time || null,
    createdTime:page.created_time,
    lastEditedTime:page.last_edited_time
  };
}
export function projectReportRecord(page) {
  if(page.archived || page.in_trash) return null;
  return { id:page.id, goal:prop(page,"올해 목표 권수")?.number || 0, createdTime:page.created_time, lastEditedTime:page.last_edited_time };
}
export function projectLibrary(pages, report) {
  return composeLibrary(pages.map(projectBookRecord).filter(Boolean), report.map(projectReportRecord).filter(Boolean));
}
export function composeLibrary(records, report) {
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
const goal = [...report].sort((a,b)=>new Date(a.createdTime||0)-new Date(b.createdTime||0))[0]?.goal || 0;
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

// Only expiring Notion-hosted covers need extra per-page reads; external covers do not.
export async function retrieveBookRecord(id, token, fetchImpl = fetch, deadline = Date.now() + 20000) {
  if (Date.now() >= deadline) throw new Error("Notion query deadline exceeded");
  const res = await fetchImpl(`${API}/pages/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION },
    signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - Date.now())))
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Notion API status ${res.status}`);
  const page = await res.json();
  if (page.parent?.data_source_id && page.parent.data_source_id !== BOOKS_SOURCE) return null;
  return projectBookRecord(page);
}
