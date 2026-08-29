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
    setFreeConnected(Boolean(getFreeAiKey()));
    const initialTimer=setTimeout(()=>{void refreshStatus();},0);
    if(!["GENERATING","REVIEWING","PAUSED","PLANNING"].includes(status.status)) return()=>clearTimeout(initialTimer);
    const timer=setInterval(()=>{void refreshStatus();},5000);
    return()=>{clearTimeout(initialTimer);clearInterval(timer);};
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
      <Link href="/dashboard" className="brand">AI Book Studio<small>← Library</small></Link>
      <div style={{marginTop:24}}><strong>{book.title}</strong><p className="muted" style={{fontSize:12}}>{book.subtitle}</p></div>
      <div className="tree">
        {book.parts.map(part=><div key={part.id}>
          <div className="part" onDoubleClick={()=>rename("part",part.id,part.title)}>{part.title}</div>
          {part.chapters.map(chapter=><div key={chapter.id} className="outline-group">
            <div className="outline-row"><span className="chapter-label" onDoubleClick={()=>rename("chapter",chapter.id,chapter.title)}>{chapter.position+1}. {chapter.title}</span><button className="mini" onClick={()=>add("section",chapter.id)}>＋</button></div>
            {chapter.sections.map(section=><div key={section.id} className="outline-row" draggable onDragStart={(e)=>e.dataTransfer.setData("text/plain",section.id)} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>moveSection(chapter.id,e.dataTransfer.getData("text/plain"),section.id)}>
              <button className={section.id===selectedId?"active":""} onClick={()=>selectSection(section)} onDoubleClick={()=>rename("section",section.id,section.title)}>{section.title}</button><button className="mini" onClick={()=>remove("section",section.id)}>×</button>
            </div>)}
            <button className="mini add-row" onClick={()=>add("chapter",part.id)}>＋ Chapter</button>
          </div>)}
        </div>)}
      </div>
      <p className="muted help">Tip: 제목 더블클릭 = 이름 변경 · Section 드래그 = 순서 변경</p>
    </aside>

    <main className="editor-canvas">
      <div className="editor-topbar"><div><div className="eyebrow">{selected?.layout_hint??"Book editor"}</div><h2>{selected?.title??"목차를 선택하세요"}</h2></div><span className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved" : saveState === "error" ? "Save error" : "Saved"}</span></div>
      <article className="page">{selected?<textarea aria-label="section manuscript" value={content} onChange={(e)=>changeContent(e.target.value)} placeholder="이 Section의 원고가 여기에 표시됩니다."/>:<p className="muted">목차에서 Section을 선택하세요.</p>}</article>
    </main>

    <aside className="ai-panel">
      <div className="eyebrow">Free AI Generation</div>
      <div className="meta-row"><strong>{status.status}</strong><span>{Math.round(status.progress)}%</span></div><div className="progress-track"><span style={{width:`${Math.min(100,status.progress)}%`}}/></div>
      <p className="muted" style={{fontSize:12}}>{freeConnected?"OpenRouter 무료 AI 연결됨 · 생성 비용 0원":"무료 AI 연결 후 집필을 시작할 수 있습니다."}</p>
      <div className="actions">
        {!freeConnected&&<button className="button" onClick={connectFreeAi}>무료 AI 연결</button>}
        {freeConnected&&status.status!=="COMPLETED"&&!busy&&<button className="button" onClick={startGeneration}>{status.progress>0?"무료 이어서 생성":"무료로 책 생성"}</button>}
        {busy&&<button className="button secondary" onClick={()=>control("pause")}>현재 Section 후 일시정지</button>}
        {status.status==="PAUSED"&&!busy&&<button className="button secondary" onClick={startGeneration}>무료 이어서 생성</button>}
        {["GENERATING","PAUSED"].includes(status.status)&&<button className="button ghost" onClick={()=>control("cancel")}>Cancel</button>}
      </div>

      <hr className="rule"/><div className="eyebrow">Free AI Assistant</div><div className="ai-box field"><textarea value={command} onChange={(e)=>setCommand(e.target.value)} placeholder="예: 이 부분을 중학생이 이해하기 쉽게 바꾸고 구체적인 예시를 하나 추가해."/><button className="button" disabled={busy||!selected||!command.trim()} onClick={aiRewrite}>{busy?"Working…":"무료 AI로 수정"}</button></div>

      <hr className="rule"/><div className="eyebrow">Version history</div><button className="button secondary" disabled={!selected} onClick={loadHistory}>Load history</button><div className="history-list">{history.slice(0,8).map(rev=><button key={rev.id} onClick={()=>restoreRevision(rev.id)}><b>{rev.revision_type}</b><span>{new Date(rev.created_at).toLocaleString("ko-KR")}</span><small>{rev.instruction??"manual edit"}</small></button>)}</div>

      {status.quality_score!=null&&<><hr className="rule"/><div className="eyebrow">Book quality · {Math.round(Number(status.quality_score))}/100</div><div className="score-grid">{Object.entries(scores).map(([key,value])=><div className="score" key={key}><b>{Math.round(Number(value))}</b><span>{key}</span></div>)}</div></>}

      <hr className="rule"/><div className="eyebrow">Export</div><div className="export-grid">{["pdf","epub","docx","md","txt"].map(format=><a className="button secondary" key={format} href={`/api/books/${book.id}/export/${format}`}>{format.toUpperCase()}</a>)}</div>

      {logs.length>0&&<><hr className="rule"/><div className="eyebrow">Generation log</div><div className="log">{logs.slice(0,12).map(log=><div key={log.id}>{new Date(log.created_at).toLocaleTimeString("ko-KR")} · {log.message}</div>)}</div></>}
    </aside>
  </div>;
}
