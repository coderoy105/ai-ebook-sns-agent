"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { beginFreeAiConnect, consumeFreeAiJustConnected, getFreeAiKey } from "@/lib/ai/openrouter-browser";
import { BookEditor, type Book } from "./book-editor";

type Job = { id:string; status:string; progress:number; workflow_run_id:string|null } | null;
type Log = { id:string; message:string; created_at:string };

type PlanningState = {
  bookStatus: string;
  progress: number;
  job: Job;
  logs: Log[];
};

function planningLabel(jobStatus:string,bookStatus:string) {
  if(jobStatus==="WAITING_LIMIT") return "무료 한도 대기 중";
  if(jobStatus==="NEEDS_RECONNECT") return "무료 AI 재연결 필요";
  if(jobStatus==="PAUSED_ERROR") return "AI 제공자 오류로 일시정지";
  if(jobStatus==="RETRYING") return "자동 재시도 대기 중";
  if(jobStatus==="QUEUED") return "백그라운드 작업 등록 중";
  if(jobStatus==="PLANNING"||bookStatus==="PLANNING") return "Book Blueprint 생성 중";
  if(bookStatus==="FAILED") return "기획 작업 재시도 필요";
  return "Book Blueprint 준비 중";
}

export function BookEditorShell({initialBook}:{initialBook:Book}) {
  const planningOnly=initialBook.parts.length===0&&["PLANNING","FAILED"].includes(initialBook.status);
  if(!planningOnly) return <BookEditor initialBook={initialBook}/>;
  return <PlanningWorkspace initialBook={initialBook}/>;
}

function PlanningWorkspace({initialBook}:{initialBook:Book}) {
  const [state,setState]=useState<PlanningState>({bookStatus:initialBook.status,progress:Number(initialBook.progress),job:null,logs:[]});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const reconnectConsumed=useRef(false);

  const refresh=useCallback(async()=>{
    const response=await fetch(`/api/books/${initialBook.id}/status`,{cache:"no-store"});
    if(!response.ok)return;
    const data=await response.json();
    if(data.book?.status==="DRAFT"||data.book?.status==="GENERATING"||data.book?.status==="COMPLETED"){
      location.reload();
      return;
    }
    setState({
      bookStatus:String(data.book?.status??initialBook.status),
      progress:Number(data.book?.progress??0),
      job:data.job??null,
      logs:data.logs??[]
    });
  },[initialBook.id,initialBook.status]);

  const resumePlanning=useCallback(async()=>{
    if(busy)return;
    setBusy(true);setError("");
    try{
      const key=getFreeAiKey();
      const headers:Record<string,string>={};
      if(key)headers["x-openrouter-key"]=key;
      const response=await fetch(`/api/books/${initialBook.id}/plan`,{method:"POST",headers});
      const data=await response.json();
      if(response.status===428||data.reconnect){
        await beginFreeAiConnect(`/books/${initialBook.id}`);
        return;
      }
      if(!response.ok)throw new Error(data.error??"기획 작업을 재개하지 못했습니다.");
      await refresh();
    }catch(caught){
      setError(caught instanceof Error?caught.message:"기획 작업을 재개하지 못했습니다.");
    }finally{setBusy(false);}
  },[busy,initialBook.id,refresh]);

  useEffect(()=>{
    const first=setTimeout(()=>{void refresh();},0);
    const timer=setInterval(()=>{void refresh();},3000);
    return()=>{clearTimeout(first);clearInterval(timer);};
  },[refresh]);

  useEffect(()=>{
    if(reconnectConsumed.current)return;
    reconnectConsumed.current=true;
    const justConnected=consumeFreeAiJustConnected();
    if(justConnected&&state.job?.status==="NEEDS_RECONNECT")void resumePlanning();
  },[resumePlanning,state.job?.status]);

  const jobStatus=state.job?.status??"";
  const needsReconnect=jobStatus==="NEEDS_RECONNECT";
  const canRetry=jobStatus==="PAUSED_ERROR"||state.bookStatus==="FAILED";

  return <div className="editor-shell">
    <aside className="editor-sidebar">
      <Link href="/dashboard" className="editor-brand"><span>AI BOOK</span><strong>STUDIO</strong></Link>
      <div className="manuscript-identity">
        <span>{initialBook.book_type}</span>
        <strong>{initialBook.title}</strong>
        <p>프로젝트는 서버에 저장되었습니다.</p>
      </div>
      <div className="tree">
        <div className="part">BOOK BLUEPRINT</div>
        <p className="outline-help">AI가 Part · Chapter · Section 구조를 백그라운드에서 만들고 있습니다.</p>
      </div>
      <p className="outline-help">이 화면을 닫아도 작업은 계속됩니다. 다시 들어오면 같은 작업을 불러옵니다.</p>
    </aside>

    <main className="editor-canvas">
      <div className="editor-topbar">
        <div><div className="editor-context"><span>BACKGROUND</span><span>SERVER SAVED</span></div><h2>{planningLabel(jobStatus,state.bookStatus)}</h2></div>
      </div>
      <article className="page">
        <h2>Book Blueprint 생성 중</h2>
        <p>입력한 책 아이디어와 독자·문체·분량·디자인 설정은 이미 프로젝트에 저장됐습니다.</p>
        <p>Vercel Workflow가 서버에서 목차를 생성하므로 대시보드로 이동하거나 브라우저를 닫아도 중단되지 않습니다.</p>
        {jobStatus==="WAITING_LIMIT"&&<p><strong>무료 한도를 모두 사용했습니다.</strong> 현재 결과는 저장되어 있고 Workflow가 대기 후 자동으로 다시 시도합니다.</p>}
        {needsReconnect&&<p><strong>OpenRouter 연결이 만료됐습니다.</strong> 다시 연결하면 같은 프로젝트에서 이어서 기획합니다.</p>}
        {canRetry&&<p><strong>무료 AI 제공자 오류로 기획이 멈췄습니다.</strong> 저장된 프로젝트에서 다시 시도할 수 있습니다.</p>}
        {error&&<p className="notice" role="alert">{error}</p>}
      </article>
    </main>

    <aside className="ai-panel">
      <section className="ai-module generation-module">
        <div className="module-heading"><h3>기획 진행률</h3><span className={`state-badge state-${(jobStatus||state.bookStatus).toLowerCase()}`}>{planningLabel(jobStatus,state.bookStatus)}</span></div>
        <div className="generation-number"><strong>{Math.round(state.progress)}%</strong><span>서버 저장 진행률</span></div>
        <div className="progress-track"><span style={{width:`${Math.max(0,Math.min(100,state.progress))}%`}}/></div>
        <p>진행률과 로그는 브라우저가 아니라 서버 DB에서 다시 불러옵니다.</p>
        <div className="panel-actions">
          {needsReconnect&&<button className="button button-primary" disabled={busy} onClick={()=>beginFreeAiConnect(`/books/${initialBook.id}`)}>무료 AI 다시 연결</button>}
          {canRetry&&<button className="button button-primary" disabled={busy} onClick={()=>void resumePlanning()}>{busy?"작업 등록 중…":"저장된 기획 다시 시도"}</button>}
          <Link className="button secondary" href="/dashboard">대시보드로 이동</Link>
        </div>
      </section>
      {state.logs.length>0&&<section className="ai-module"><div className="module-heading"><h3>생성 로그</h3></div><div className="log">{state.logs.slice(0,12).map(log=><div key={log.id}>{new Date(log.created_at).toLocaleTimeString("ko-KR")} · {log.message}</div>)}</div></section>}
    </aside>
  </div>;
}
