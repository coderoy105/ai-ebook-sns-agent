"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beginFreeAiConnect, getFreeAiKey } from "@/lib/ai/openrouter-browser";
import { connectCodexChatGPT, getCodexConnectionStatus, type CodexDeviceEvent } from "@/lib/ai/codex-browser";
import { ChatGptDeviceCodePanel } from "@/components/chatgpt-device-code-panel";
import { PagedManuscriptEditor } from "./paged-manuscript-editor";

type Section = { id:string; title:string; goal:string|null; position:number; status:string; target_words:number; word_count:number; content_markdown:string|null; summary:string|null; layout_hint:string|null };
type Chapter = { id:string; title:string; goal:string|null; position:number; status:string; target_words:number; word_count:number; sections:Section[] };
type Part = { id:string; title:string; purpose:string|null; position:number; chapters:Chapter[] };
export type Book = { id:string; title:string; subtitle:string|null; idea:string; book_type:string; status:string; progress:number; target_pages:number; target_words:number; quality_score:number|null; quality_scores:Record<string,number>; parts:Part[]; book_blueprints:unknown[]; book_covers:unknown[] };
type Revision = { id:string; revision_type:string; instruction:string|null; title_before:string|null; content_before:string|null; created_at:string };
type GenerationLog = { id:string; created_at:string; message:string };
type LocalSectionDraft = { content:string; updatedAt:number };
type AiProvider = "openrouter" | "codex";
type DevicePrompt = { verificationUrl:string; userCode:string };

function sortBook(book: Book) {
  return {
    ...book,
    parts: [...book.parts].sort((a,b)=>a.position-b.position).map((part)=>({
      ...part, chapters:[...part.chapters].sort((a,b)=>a.position-b.position).map((chapter)=>({ ...chapter, sections:[...chapter.sections].sort((a,b)=>a.position-b.position) }))
    }))
  };
}

function statusLabel(status: string, jobStatus?: string) {
  if (jobStatus === "WAITING_LIMIT") return "사용 한도 대기";
  if (jobStatus === "NEEDS_RECONNECT") return "AI 재연결 필요";
  if (jobStatus === "PAUSED_ERROR") return "오류로 일시정지";
  if (jobStatus === "QUEUED") return "작업 등록 중";
  if (status === "GENERATING") return "백그라운드 집필 중";
  if (status === "PAUSED") return "일시정지";
  if (status === "COMPLETED") return "완료";
  if (status === "PLANNING") return "구성 중";
  if (status === "CANCELLED") return "취소됨";
  return status;
}

function draftKey(bookId:string, sectionId:string) {
  return `ai-book-studio:manuscript-draft:${bookId}:${sectionId}`;
}

function readSectionDraft(bookId:string, sectionId:string):LocalSectionDraft|null {
  if(typeof window === "undefined" || !sectionId) return null;
  try {
    const raw=localStorage.getItem(draftKey(bookId,sectionId));
    if(!raw) return null;
    const parsed=JSON.parse(raw) as LocalSectionDraft;
    return parsed && typeof parsed.content === "string" ? parsed : null;
  } catch { return null; }
}

function writeSectionDraft(bookId:string, sectionId:string, content:string) {
  try { localStorage.setItem(draftKey(bookId,sectionId),JSON.stringify({content,updatedAt:Date.now()} satisfies LocalSectionDraft)); }
  catch { /* browser storage can be unavailable */ }
}

function clearSectionDraft(bookId:string, sectionId:string) {
  try { localStorage.removeItem(draftKey(bookId,sectionId)); }
  catch { /* no-op */ }
}

export function BookEditor({ initialBook }: { initialBook: Book }) {
  const [book,setBook] = useState(()=>sortBook(initialBook));
  const firstSection = book.parts[0]?.chapters[0]?.sections[0] ?? null;
  const firstSectionId = firstSection?.id ?? "";
  const firstServerContent = firstSection?.content_markdown ?? "";
  const [selectedId,setSelectedId] = useState(firstSectionId);
  const selectedIdRef = useRef(firstSectionId);
  const selected = useMemo(()=>book.parts.flatMap(p=>p.chapters).flatMap(c=>c.sections).find(s=>s.id===selectedId) ?? null,[book,selectedId]);
  const [content,setContent] = useState(firstServerContent);
  const [saveState,setSaveState] = useState("saved");
  const [command,setCommand] = useState("");
  const [busy,setBusy] = useState(false);
  const [freeConnected,setFreeConnected] = useState(false);
  const [codexConnected,setCodexConnected] = useState(false);
  const [codexConnecting,setCodexConnecting] = useState(false);
  const [devicePrompt,setDevicePrompt] = useState<DevicePrompt|null>(null);
  const [aiProvider,setAiProvider] = useState<AiProvider>("openrouter");
  const [logs,setLogs] = useState<GenerationLog[]>([]);
  const [status,setStatus] = useState({status:book.status,jobStatus:"",progress:Number(book.progress),quality_score:book.quality_score,quality_scores:book.quality_scores});
  const [history,setHistory] = useState<Revision[]>([]);
  const [mobilePanel,setMobilePanel] = useState<"outline"|"ai"|null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  const refreshStatus = useCallback(async()=>{
    const res=await fetch(`/api/books/${book.id}/status`,{cache:"no-store"});
    if(!res.ok) return;
    const data=await res.json();
    setAiProvider(data.aiProvider==="codex"?"codex":"openrouter");
    setStatus({
      status:data.book.status,
      jobStatus:data.job?.status??"",
      progress:Number(data.book.progress),
      quality_score:data.book.quality_score,
      quality_scores:data.book.quality_scores??{}
    });
    setLogs(data.logs??[]);
  },[book.id]);

  const refreshConnection = useCallback(async()=>{
    const localConnected=Boolean(getFreeAiKey());
    const [freeResult,codexResult]=await Promise.allSettled([
      fetch("/api/auth/openrouter/connection",{cache:"no-store"}).then(async res=>({res,data:await res.json()})),
      getCodexConnectionStatus()
    ]);
    if(freeResult.status==="fulfilled") setFreeConnected(localConnected || (freeResult.value.res.ok && freeResult.value.data.connected===true));
    else setFreeConnected(localConnected);
    if(codexResult.status==="fulfilled") setCodexConnected(codexResult.value.connected===true && codexResult.value.modelAvailable!==false);
  },[]);

  useEffect(()=>{
    const connectionTimer=setTimeout(()=>{void refreshConnection();},0);
    const initialTimer=setTimeout(()=>{void refreshStatus();},0);
    const active=["GENERATING","REVIEWING","PAUSED","PLANNING"].includes(status.status) || ["QUEUED","GENERATING","WAITING_LIMIT","PAUSED"].includes(status.jobStatus);
    if(!active) return()=>{clearTimeout(connectionTimer);clearTimeout(initialTimer);};
    const timer=setInterval(()=>{void refreshStatus();},3000);
    return()=>{clearTimeout(connectionTimer);clearTimeout(initialTimer);clearInterval(timer);};
  },[refreshConnection,refreshStatus,status.jobStatus,status.status]);

  useEffect(()=>{
    const timer=setTimeout(()=>{
      if(!firstSectionId || selectedIdRef.current!==firstSectionId) return;
      const draft=readSectionDraft(book.id,firstSectionId);
      if(draft && draft.content!==firstServerContent){ setContent(draft.content); setSaveState("recovered"); }
    },0);
    return()=>clearTimeout(timer);
  },[book.id,firstSectionId,firstServerContent]);

  function patchLocalSection(id:string, patch:Partial<Section>) {
    setBook(prev=>({...prev,parts:prev.parts.map(part=>({...part,chapters:part.chapters.map(chapter=>({...chapter,sections:chapter.sections.map(section=>section.id===id?{...section,...patch}:section)}))}))}));
  }

  async function saveSection(sectionId:string,nextContent:string) {
    if(!sectionId) return;
    if(selectedIdRef.current===sectionId) setSaveState("saving");
    try {
      const res=await fetch(`/api/sections/${sectionId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({content:nextContent})});
      if(!res.ok){ if(selectedIdRef.current===sectionId) setSaveState("error"); return; }
      clearSectionDraft(book.id,sectionId);
      patchLocalSection(sectionId,{content_markdown:nextContent,word_count:nextContent.trim().split(/\s+/).filter(Boolean).length});
      if(selectedIdRef.current===sectionId) setSaveState("saved");
    } catch { if(selectedIdRef.current===sectionId) setSaveState("error"); }
  }

  function selectSection(section:Section) {
    if(section.id===selectedId) return;
    if(saveTimer.current){ clearTimeout(saveTimer.current); saveTimer.current=null; }
    if(selected && ["dirty","recovered","error"].includes(saveState)) void saveSection(selected.id,content);
    selectedIdRef.current=section.id;
    setSelectedId(section.id);
    const serverContent=section.content_markdown ?? "";
    const draft=readSectionDraft(book.id,section.id);
    if(draft && draft.content!==serverContent){ setContent(draft.content); setSaveState("recovered"); }
    else { setContent(serverContent); setSaveState("saved"); }
    setHistory([]);
    setMobilePanel(null);
  }

  function changeContent(value:string) {
    setContent(value);
    if(!selected) return;
    writeSectionDraft(book.id,selected.id,value);
    setSaveState("dirty");
    if(saveTimer.current) clearTimeout(saveTimer.current);
    const sectionId=selected.id;
    saveTimer.current=setTimeout(()=>{ saveTimer.current=null; void saveSection(sectionId,value); },650);
  }

  async function connectFreeAi(){ await beginFreeAiConnect(`/books/${book.id}`); }

  async function connectCodex(){
    setCodexConnecting(true);setDevicePrompt(null);
    try{
      const result=await connectCodexChatGPT({openVerificationPage:false,onEvent(event:CodexDeviceEvent){if(event.type==="device_code")setDevicePrompt({verificationUrl:event.verificationUrl,userCode:event.userCode});}});
      if(!result.modelAvailable) throw new Error("이 ChatGPT 계정에서 GPT-5.6 Luna를 사용할 수 없습니다.");
      setCodexConnected(true);setDevicePrompt(null);await refreshStatus();
    }catch(error){alert(error instanceof Error?error.message:"ChatGPT Plus 연결에 실패했습니다.");}
    finally{setCodexConnecting(false);}
  }

  async function connectCurrentProvider(){ if(aiProvider==="codex")await connectCodex();else await connectFreeAi(); }

  async function control(action:"pause"|"resume"|"cancel"){
    const r=await fetch(`/api/books/${book.id}/control`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})});
    if(r.ok) void refreshStatus();
  }

  async function startGeneration(){
    setBusy(true);
    try{
      const headers:Record<string,string>={};
      if(aiProvider==="openrouter"){
        const key=getFreeAiKey();
        if(key) headers["x-openrouter-key"]=key;
      }
      const r=await fetch(`/api/books/${book.id}/generate`,{method:"POST",headers});
      const data=await r.json();
      if(r.status===428 || data.reconnect){
        if(data.provider==="codex" || aiProvider==="codex") await connectCodex();
        else await connectFreeAi();
        return;
      }
      if(!r.ok) throw new Error(data.error??"백그라운드 책 생성 시작에 실패했습니다.");
      if(data.provider==="codex")setCodexConnected(true);else setFreeConnected(true);
      setStatus(s=>({...s,status:data.done?"COMPLETED":"GENERATING",jobStatus:data.done?"COMPLETED":"GENERATING",progress:Number(data.progress??s.progress)}));
      await refreshStatus();
    }catch(error){ alert(error instanceof Error?error.message:"백그라운드 책 생성 시작에 실패했습니다."); }
    finally{ setBusy(false); }
  }

  async function aiRewrite(){
    if(!selected||!command.trim())return;
    if(aiProvider==="codex" && !codexConnected){ await connectCodex(); return; }
    const key=aiProvider==="openrouter"?getFreeAiKey():null;
    if(aiProvider==="openrouter"&&!key){await connectFreeAi();return;}
    setBusy(true);
    const headers:Record<string,string>={"content-type":"application/json"};
    if(key)headers["x-openrouter-key"]=key;
    try{
      const r=await fetch(`/api/sections/${selected.id}/rewrite`,{method:"POST",headers,body:JSON.stringify({instruction:command})});
      const data=await r.json();
      if(r.status===428||data.reconnect){await connectCurrentProvider();return;}
      if(!r.ok){
        const limit=data.error==="FREE_AI_DAILY_LIMIT"||data.error==="CODEX_USAGE_LIMIT";
        alert(limit?`${providerLabel} 사용 한도에 도달했습니다. 한도가 초기화되면 다시 사용할 수 있습니다.`:data.error??"Rewrite failed");
        return;
      }
      clearSectionDraft(book.id,selected.id);
      setContent(data.markdown);patchLocalSection(selected.id,{content_markdown:data.markdown,summary:data.summary});setSaveState("saved");setCommand("");void loadHistory();
    }finally{setBusy(false);}
  }

  async function loadHistory(){ if(!selected)return; const r=await fetch(`/api/sections/${selected.id}/revisions`); if(r.ok)setHistory((await r.json()).revisions??[]); }
  async function restoreRevision(id:string){ if(!confirm("이 버전으로 복원할까요? 현재 내용은 새 Revision으로 보존됩니다."))return; const r=await fetch(`/api/revisions/${id}/restore`,{method:"POST"}); if(r.ok){const d=await r.json();clearSectionDraft(book.id,selectedId);setContent(d.content);patchLocalSection(selectedId,{content_markdown:d.content});setSaveState("saved");void loadHistory();} }

  async function rename(kind:"part"|"chapter"|"section",id:string,current:string){ const title=prompt("새 제목",current)?.trim(); if(!title||title===current)return; const r=await fetch(`/api/outline/${kind}/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({title})}); if(r.ok) location.reload(); }
  async function remove(kind:"chapter"|"section",id:string){ if(!confirm("삭제하면 원고와 연결된 데이터도 함께 삭제됩니다. 계속할까요?"))return; const r=await fetch(`/api/outline/${kind}/${id}`,{method:"DELETE"}); if(r.ok){ if(kind==="section") clearSectionDraft(book.id,id); location.reload(); } }
  async function add(kind:"chapter"|"section",parentId:string){ const title=prompt(`${kind === "chapter" ? "Chapter" : "Section"} 제목`)?.trim(); if(!title)return; const r=await fetch(`/api/books/${book.id}/outline`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,parentId,title})}); if(r.ok)location.reload(); }

  async function moveSection(chapterId:string,draggedId:string,targetId:string){
    if(draggedId===targetId)return;
    const chapter=book.parts.flatMap(p=>p.chapters).find(c=>c.id===chapterId); if(!chapter)return;
    const ids=chapter.sections.map(s=>s.id); const from=ids.indexOf(draggedId),to=ids.indexOf(targetId); if(from<0||to<0)return;
    ids.splice(to,0,ids.splice(from,1)[0]);
    const r=await fetch(`/api/books/${book.id}/outline`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"section",ids})}); if(r.ok)location.reload();
  }

  const scores=status.quality_scores??{};
  const backgroundRunning=status.status==="GENERATING" || ["QUEUED","GENERATING","WAITING_LIMIT"].includes(status.jobStatus);
  const needsReconnect=status.jobStatus==="NEEDS_RECONNECT";
  const providerConnected=aiProvider==="codex"?codexConnected:freeConnected;
  const providerLabel=aiProvider==="codex"?"GPT-5.6 Luna · ChatGPT Plus":"OpenRouter Free";

  return <div className="editor-shell manuscript-editor-shell">
    <header className="editor-mobile-header">
      <Link href="/dashboard" className="editor-mobile-back" aria-label="작업실로 돌아가기">←</Link>
      <div className="editor-mobile-title"><span>{book.book_type}</span><strong>{selected?.title ?? book.title}</strong></div>
      <button type="button" className="editor-mobile-action" aria-controls="book-ai-panel" aria-expanded={mobilePanel==="ai"} onClick={()=>setMobilePanel(mobilePanel==="ai"?null:"ai")}>AI</button>
    </header>
    {mobilePanel&&<button type="button" className="editor-mobile-scrim" aria-label="패널 닫기" onClick={()=>setMobilePanel(null)} />}

    <aside id="book-outline-panel" className={`editor-sidebar ${mobilePanel==="outline"?"mobile-open":""}`}>
      <div className="mobile-sheet-head"><strong>책 목차</strong><button type="button" onClick={()=>setMobilePanel(null)}>닫기</button></div>
      <Link href="/dashboard" className="editor-brand"><span>AI BOOK</span><strong>STUDIO</strong></Link>
      <div className="manuscript-identity"><span>{book.book_type}</span><strong>{book.title}</strong><p>{book.subtitle || "부제 없음"}</p></div>
      <div className="tree" aria-label="책 목차">
        {book.parts.map(part=><div key={part.id}>
          <div className="part" onDoubleClick={()=>rename("part",part.id,part.title)}>{part.title}</div>
          {part.chapters.map(chapter=><div key={chapter.id} className="outline-group">
            <div className="outline-row chapter-row"><span className="chapter-label" onDoubleClick={()=>rename("chapter",chapter.id,chapter.title)}>{chapter.position+1}. {chapter.title}</span><button className="mini" aria-label="Section 추가" onClick={()=>add("section",chapter.id)}>+</button></div>
            {chapter.sections.map(section=><div key={section.id} className="outline-row" draggable onDragStart={(e)=>e.dataTransfer.setData("text/plain",section.id)} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>moveSection(chapter.id,e.dataTransfer.getData("text/plain"),section.id)}>
              <button className={section.id===selectedId?"active":""} onClick={()=>selectSection(section)} onDoubleClick={()=>rename("section",section.id,section.title)}><span>{section.title}</span><small>{section.word_count ? `${section.word_count}w` : section.status}</small></button><button className="mini" aria-label="Section 삭제" onClick={()=>remove("section",section.id)}>×</button>
            </div>)}
            <button className="mini add-row" onClick={()=>add("chapter",part.id)}>+ Chapter</button>
          </div>)}
        </div>)}
      </div>
      <p className="outline-help">제목 더블클릭으로 이름 변경 · Section 드래그로 순서 변경</p>
    </aside>

    <main className="editor-canvas">
      <div className="editor-topbar">
        <div><div className="editor-context"><span>{selected?.layout_hint??"MANUSCRIPT"}</span><span>{selected?.word_count ?? 0} words</span></div><h2>{selected?.title??"목차에서 Section을 선택하세요"}</h2></div>
        <span className={`save-state ${saveState}`}>{saveState === "saving" ? "서버 저장 중" : saveState === "dirty" ? "기기에 임시저장됨" : saveState === "recovered" ? "임시저장 복원됨" : saveState === "error" ? "서버 저장 오류 · 기기에는 보관됨" : "저장됨"}</span>
      </div>
      {selected
        ? <PagedManuscriptEditor value={content} onChange={changeContent} placeholder="이 Section의 원고가 여기에 표시됩니다." />
        : <article className="page"><p className="muted">왼쪽 목차에서 편집할 Section을 선택하세요.</p></article>}
    </main>

    <aside id="book-ai-panel" className={`ai-panel ${mobilePanel==="ai"?"mobile-open":""}`}>
      <div className="mobile-sheet-head"><strong>AI · 출판 도구</strong><button type="button" onClick={()=>setMobilePanel(null)}>닫기</button></div>
      <section className="ai-module generation-module">
        <div className="module-heading"><h3>AI 백그라운드 생성</h3><span className={`state-badge state-${(status.jobStatus||status.status).toLowerCase()}`}>{statusLabel(status.status,status.jobStatus)}</span></div>
        <p className="muted">{providerLabel}</p>
        <div className="generation-number"><strong>{Math.round(status.progress)}%</strong><span>전체 원고 진행률</span></div>
        <div className="progress-track"><span style={{width:`${Math.min(100,status.progress)}%`}}/></div>
        <p>{status.jobStatus==="WAITING_LIMIT"
          ? `${providerLabel} 사용 한도 대기 중입니다. 작성된 원고는 저장됐고 Workflow가 자동으로 다시 확인합니다.`
          : backgroundRunning
            ? `${providerLabel}로 백그라운드 집필 중입니다. 다른 화면으로 이동하거나 브라우저를 닫아도 계속 진행됩니다.`
            : providerConnected
              ? `${providerLabel}가 서버에 연결되어 있어 백그라운드 생성이 가능합니다.`
              : `${providerLabel} 연결이 필요합니다.`}</p>

        {devicePrompt&&<ChatGptDeviceCodePanel verificationUrl={devicePrompt.verificationUrl} userCode={devicePrompt.userCode}/>}
        <div className="panel-actions">
          {(!providerConnected||needsReconnect)&&<button className="button button-primary" disabled={codexConnecting} onClick={connectCurrentProvider}>{codexConnecting?"OpenAI 로그인 완료를 기다리는 중…":aiProvider==="codex"?"ChatGPT로 계속하기":`${providerLabel} ${needsReconnect?"다시 ":""}연결`}</button>}
          {providerConnected&&!backgroundRunning&&status.status!=="COMPLETED"&&status.status!=="PAUSED"&&!busy&&<button className="button button-primary" onClick={startGeneration}>{status.progress>0?"백그라운드 이어서 생성":"백그라운드 책 생성 시작"}</button>}
          {providerConnected&&status.status==="PAUSED"&&!needsReconnect&&!busy&&<button className="button button-primary" onClick={startGeneration}>백그라운드 이어서 생성</button>}
          {busy&&<button className="button secondary" disabled>작업 등록 중…</button>}
          {backgroundRunning&&status.jobStatus!=="WAITING_LIMIT"&&<button className="button secondary" onClick={()=>control("pause")}>현재 Section 후 정지</button>}
          {["GENERATING","PAUSED"].includes(status.status)&&<button className="button ghost" onClick={()=>control("cancel")}>생성 취소</button>}
        </div>
      </section>

      <section className="ai-module">
        <div className="module-heading"><h3>AI 편집 지시</h3></div>
        <div className="ai-box field"><textarea value={command} onChange={(e)=>setCommand(e.target.value)} placeholder="예: 이 부분을 중학생이 이해하기 쉽게 바꾸고 구체적인 예시를 하나 추가해."/><button className="button secondary" disabled={busy||!selected||!command.trim()} onClick={aiRewrite}>{busy?"처리 중…":"선택 Section 수정"}</button></div>
      </section>

      <section className="ai-module">
        <div className="module-heading"><h3>버전 기록</h3><button className="text-button" disabled={!selected} onClick={loadHistory}>불러오기</button></div>
        <div className="history-list">{history.slice(0,8).map(rev=><button key={rev.id} onClick={()=>restoreRevision(rev.id)}><b>{rev.revision_type}</b><span>{new Date(rev.created_at).toLocaleString("ko-KR")}</span><small>{rev.instruction??"manual edit"}</small></button>)}</div>
      </section>

      {status.quality_score!=null&&<section className="ai-module"><div className="module-heading"><h3>품질 점검</h3><strong>{Math.round(Number(status.quality_score))}/100</strong></div><div className="score-grid">{Object.entries(scores).map(([key,value])=><div className="score" key={key}><b>{Math.round(Number(value))}</b><span>{key}</span></div>)}</div></section>}

      <section className="ai-module"><div className="module-heading"><h3>내보내기</h3></div><div className="export-grid">{["pdf","epub","docx","md","txt"].map(format=><a className="export-link" key={format} href={`/api/books/${book.id}/export/${format}`}>{format.toUpperCase()}</a>)}</div></section>

      {logs.length>0&&<section className="ai-module"><div className="module-heading"><h3>생성 로그</h3></div><div className="log">{logs.slice(0,12).map(log=><div key={log.id}>{new Date(log.created_at).toLocaleTimeString("ko-KR")} · {log.message}</div>)}</div></section>}
    </aside>

    <nav className="editor-mobile-dock" aria-label="원고 편집 도구">
      <button type="button" aria-controls="book-outline-panel" aria-expanded={mobilePanel==="outline"} onClick={()=>setMobilePanel(mobilePanel==="outline"?null:"outline")}>목차</button>
      <button type="button" className="current" aria-current="page">원고</button>
      <button type="button" aria-controls="book-ai-panel" aria-expanded={mobilePanel==="ai"} onClick={()=>setMobilePanel(mobilePanel==="ai"?null:"ai")}>AI · 도구</button>
    </nav>
  </div>;
}
