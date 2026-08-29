"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beginFreeAiConnect, getFreeAiKey } from "@/lib/ai/openrouter-browser";

type Section = { id:string; title:string; goal:string|null; position:number; status:string; target_words:number; word_count:number; content_markdown:string|null; summary:string|null; layout_hint:string|null };
type Chapter = { id:string; title:string; goal:string|null; position:number; status:string; target_words:number; word_count:number; sections:Section[] };
type Part = { id:string; title:string; purpose:string|null; position:number; chapters:Chapter[] };
export type Book = { id:string; title:string; subtitle:string|null; idea:string; book_type:string; status:string; progress:number; target_pages:number; target_words:number; quality_score:number|null; quality_scores:Record<string,number>; parts:Part[]; book_blueprints:unknown[]; book_covers:unknown[] };
type Revision = { id:string; revision_type:string; instruction:string|null; title_before:string|null; content_before:string|null; created_at:string };
type GenerationLog = { id:string; created_at:string; message:string };

function sortBook(book: Book) {
  return {
    ...book,
    parts: [...book.parts].sort((a,b)=>a.position-b.position).map((part)=>({
      ...part, chapters:[...part.chapters].sort((a,b)=>a.position-b.position).map((chapter)=>({ ...chapter, sections:[...chapter.sections].sort((a,b)=>a.position-b.position) }))
    }))
  };
}

function statusLabel(status: string) {
  if (status === "GENERATING") return "집필 중";
  if (status === "PAUSED") return "일시정지";
  if (status === "COMPLETED") return "완료";
  if (status === "PLANNING") return "구성 중";
  return status;
}

export function BookEditor({ initialBook }: { initialBook: Book }) {
  const [book,setBook] = useState(()=>sortBook(initialBook));
  const firstSection = book.parts[0]?.chapters[0]?.sections[0] ?? null;
  const [selectedId,setSelectedId] = useState(firstSection?.id ?? "");
  const selected = useMemo(()=>book.parts.flatMap(p=>p.chapters).flatMap(c=>c.sections).find(s=>s.id===selectedId) ?? null,[book,selectedId]);
  const [content,setContent] = useState(firstSection?.content_markdown ?? "");
  const [saveState,setSaveState] = useState("saved");
  const [command,setCommand] = useState("");
  const [busy,setBusy] = useState(false);
  const [freeConnected,setFreeConnected] = useState(false);
  const [logs,setLogs] = useState<GenerationLog[]>([]);
  const [status,setStatus] = useState({status:book.status,progress:Number(book.progress),quality_score:book.quality_score,quality_scores:book.quality_scores});
  const [history,setHistory] = useState<Revision[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  const refreshStatus = useCallback(async()=>{
    const res=await fetch(`/api/books/${book.id}/status`,{cache:"no-store"});
    if(!res.ok) return;
    const data=await res.json();
    setStatus({status:data.book.status,progress:Number(data.book.progress),quality_score:data.book.quality_score,quality_scores:data.book.quality_scores??{}});
    setLogs(data.logs??[]);
  },[book.id]);

  useEffect(()=>{
    const connectionTimer=setTimeout(()=>setFreeConnected(Boolean(getFreeAiKey())),0);
    const initialTimer=setTimeout(()=>{void refreshStatus();},0);
    if(!["GENERATING","REVIEWING","PAUSED","PLANNING"].includes(status.status)) {
      return()=>{clearTimeout(connectionTimer);clearTimeout(initialTimer);};
    }
    const timer=setInterval(()=>{void refreshStatus();},5000);
    return()=>{clearTimeout(connectionTimer);clearTimeout(initialTimer);clearInterval(timer);};
  },[refreshStatus,status.status]);

  function selectSection(section:Section) {
    setSelectedId(section.id);
    setContent(section.content_markdown ?? "");
    setHistory([]);
  }

  function patchLocalSection(id:string, patch:Partial<Section>) {
    setBook(prev=>({...prev,parts:prev.parts.map(part=>({...part,chapters:part.chapters.map(chapter=>({...chapter,sections:chapter.sections.map(section=>section.id===id?{...section,...patch}:section)}))}))}));
  }

  async function saveNow(nextContent=content) {
    if(!selected) return;
    setSaveState("saving");
    const res=await fetch(`/api/sections/${selected.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({content:nextContent})});
    setSaveState(res.ok?"saved":"error");
    if(res.ok) patchLocalSection(selected.id,{content_markdown:nextContent,word_count:nextContent.trim().split(/\s+/).filter(Boolean).length});
  }

  function changeContent(value:string) {
    setContent(value); setSaveState("dirty");
    if(saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{void saveNow(value);},1200);
  }

  async function connectFreeAi(){ await beginFreeAiConnect(`/books/${book.id}`); }

  async function control(action:"pause"|"resume"|"cancel"){
    const r=await fetch(`/api/books/${book.id}/control`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})});
    if(r.ok) void refreshStatus();
  }

  async function startGeneration(){
    const key=getFreeAiKey();
    if(!key){await connectFreeAi();return;}
    setFreeConnected(true);
    setBusy(true);
    try{
      if(status.status==="PAUSED"||status.status==="CANCELLED") await control("resume");
      setStatus(s=>({...s,status:"GENERATING"}));
      for(let step=0;step<500;step++){
        const r=await fetch(`/api/books/${book.id}/generate-free`,{method:"POST",headers:{"x-openrouter-key":key}});
        const data=await r.json();
        if(!r.ok){
          if(r.status===409&&(data.paused||data.cancelled)) break;
          if(r.status===429&&data.error==="FREE_AI_DAILY_LIMIT"){
            alert("오늘 무료 AI 일일 한도에 도달했습니다. 지금까지 원고는 모두 저장됐습니다. 다음 무료 한도에서 '무료 이어서 생성'을 누르면 계속됩니다.");
            break;
          }
          throw new Error(data.error??"무료 책 생성에 실패했습니다.");
        }
        setStatus(s=>({...s,status:data.done?"COMPLETED":"GENERATING",progress:Number(data.progress??s.progress)}));
        await refreshStatus();
        if(data.done){
          alert("무료 AI 책 생성이 완료되었습니다.");
          location.reload();
          break;
        }
      }
    }catch(error){
      alert(error instanceof Error?error.message:"무료 책 생성에 실패했습니다.");
    }finally{
      setBusy(false);
      void refreshStatus();
    }
  }

  async function aiRewrite(){
    if(!selected||!command.trim())return;
    const key=getFreeAiKey();
    if(!key){await connectFreeAi();return;}
    setBusy(true);
    const r=await fetch(`/api/sections/${selected.id}/rewrite`,{method:"POST",headers:{"content-type":"application/json","x-openrouter-key":key},body:JSON.stringify({instruction:command})});
    const data=await r.json(); setBusy(false);
    if(!r.ok){alert(data.error==="FREE_AI_DAILY_LIMIT"?"오늘 무료 AI 한도에 도달했습니다. 다음 한도에서 다시 사용할 수 있습니다.":data.error??"Rewrite failed");return;}
    setContent(data.markdown);patchLocalSection(selected.id,{content_markdown:data.markdown,summary:data.summary});setCommand("");void loadHistory();
  }

  async function loadHistory(){ if(!selected)return; const r=await fetch(`/api/sections/${selected.id}/revisions`); if(r.ok)setHistory((await r.json()).revisions??[]); }
  async function restoreRevision(id:string){ if(!confirm("이 버전으로 복원할까요? 현재 내용은 새 Revision으로 보존됩니다."))return; const r=await fetch(`/api/revisions/${id}/restore`,{method:"POST"}); if(r.ok){const d=await r.json();setContent(d.content);patchLocalSection(selectedId,{content_markdown:d.content});void loadHistory();} }

  async function rename(kind:"part"|"chapter"|"section",id:string,current:string){ const title=prompt("새 제목",current)?.trim(); if(!title||title===current)return; const r=await fetch(`/api/outline/${kind}/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({title})}); if(r.ok) location.reload(); }
  async function remove(kind:"chapter"|"section",id:string){ if(!confirm("삭제하면 원고와 연결된 데이터도 함께 삭제됩니다. 계속할까요?"))return; const r=await fetch(`/api/outline/${kind}/${id}`,{method:"DELETE"}); if(r.ok)location.reload(); }
  async function add(kind:"chapter"|"section",parentId:string){ const title=prompt(`${kind === "chapter" ? "Chapter" : "Section"} 제목`)?.trim(); if(!title)return; const r=await fetch(`/api/books/${book.id}/outline`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind,parentId,title})}); if(r.ok)location.reload(); }

  async function moveSection(chapterId:string,draggedId:string,targetId:string){
    if(draggedId===targetId)return;
    const chapter=book.parts.flatMap(p=>p.chapters).find(c=>c.id===chapterId); if(!chapter)return;
    const ids=chapter.sections.map(s=>s.id); const from=ids.indexOf(draggedId),to=ids.indexOf(targetId); if(from<0||to<0)return;
    ids.splice(to,0,ids.splice(from,1)[0]);
    const r=await fetch(`/api/books/${book.id}/outline`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"section",ids})}); if(r.ok)location.reload();
  }

  const scores=status.quality_scores??{};

  return <div className="editor-shell">
    <aside className="editor-sidebar">
      <Link href="/dashboard" className="editor-brand"><span>AI BOOK</span><strong>STUDIO</strong></Link>
      <div className="manuscript-identity">
        <span>{book.book_type}</span>
        <strong>{book.title}</strong>
        <p>{book.subtitle || "부제 없음"}</p>
      </div>
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
        <div>
          <div className="editor-context"><span>{selected?.layout_hint??"MANUSCRIPT"}</span><span>{selected?.word_count ?? 0} words</span></div>
          <h2>{selected?.title??"목차에서 Section을 선택하세요"}</h2>
        </div>
        <span className={`save-state ${saveState}`}>{saveState === "saving" ? "저장 중" : saveState === "dirty" ? "저장 대기" : saveState === "error" ? "저장 오류" : "저장됨"}</span>
      </div>
      <article className="page">{selected?<textarea aria-label="section manuscript" value={content} onChange={(e)=>changeContent(e.target.value)} placeholder="이 Section의 원고가 여기에 표시됩니다."/>:<p className="muted">왼쪽 목차에서 편집할 Section을 선택하세요.</p>}</article>
    </main>

    <aside className="ai-panel">
      <section className="ai-module generation-module">
        <div className="module-heading"><h3>무료 AI 생성</h3><span className={`state-badge state-${status.status.toLowerCase()}`}>{statusLabel(status.status)}</span></div>
        <div className="generation-number"><strong>{Math.round(status.progress)}%</strong><span>전체 원고 진행률</span></div>
        <div className="progress-track"><span style={{width:`${Math.min(100,status.progress)}%`}}/></div>
        <p>{freeConnected?"OpenRouter 무료 모델이 연결되어 있습니다.":"무료 AI를 연결하면 Section 단위로 원고를 작성합니다."}</p>
        <div className="panel-actions">
          {!freeConnected&&<button className="button button-primary" onClick={connectFreeAi}>무료 AI 연결</button>}
          {freeConnected&&status.status!=="COMPLETED"&&status.status!=="PAUSED"&&!busy&&<button className="button button-primary" onClick={startGeneration}>{status.progress>0?"이어서 생성":"책 생성 시작"}</button>}
          {busy&&<button className="button secondary" onClick={()=>control("pause")}>현재 Section 후 정지</button>}
          {freeConnected&&status.status==="PAUSED"&&!busy&&<button className="button button-primary" onClick={startGeneration}>이어서 생성</button>}
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

      <section className="ai-module">
        <div className="module-heading"><h3>내보내기</h3></div>
        <div className="export-grid">{["pdf","epub","docx","md","txt"].map(format=><a className="export-link" key={format} href={`/api/books/${book.id}/export/${format}`}>{format.toUpperCase()}</a>)}</div>
      </section>

      {logs.length>0&&<section className="ai-module"><div className="module-heading"><h3>생성 로그</h3></div><div className="log">{logs.slice(0,12).map(log=><div key={log.id}>{new Date(log.created_at).toLocaleTimeString("ko-KR")} · {log.message}</div>)}</div></section>}
    </aside>
  </div>;
}
