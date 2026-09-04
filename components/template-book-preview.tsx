import type { CSSProperties } from "react";
import type { TemplateCard } from "@/lib/design/template-browser";
import styles from "./template-book-preview.module.css";

type Props={template:TemplateCard;onClose?:()=>void};

export function TemplateBookPreview({template,onClose}:Props){
  const accent=template.accentColor??(template.baseTemplateId==="minimal-tech"?"#2447d8":template.baseTemplateId==="quiet-fiction"?"#9c8560":"#8a5b4b");
  const paper=template.paperTone??(template.baseTemplateId==="quiet-fiction"?"#f8f6f1":"#fffef9");
  const heading=template.headingFamily??(template.baseTemplateId==="minimal-tech"?"sans":"serif");
  const body=template.bodyFamily??(template.baseTemplateId==="minimal-tech"?"sans":"serif");
  const spacing=template.spacingScale??(template.baseTemplateId==="minimal-tech"?"balanced":"airy");
  const width=template.contentWidth??(template.baseTemplateId==="quiet-fiction"?"narrow":template.baseTemplateId==="minimal-tech"?"wide":"medium");
  const chapter=template.chapterStyle??(template.baseTemplateId==="quiet-fiction"?"classic":template.baseTemplateId==="minimal-tech"?"minimal":"bold");
  const quote=template.quoteStyle??(template.baseTemplateId==="minimal-tech"?"box":template.baseTemplateId==="quiet-fiction"?"indent":"line");
  const style={"--preview-accent":accent,"--preview-paper":paper} as CSSProperties;
  return <section className={styles.shell}>
    <header className={styles.head}><div><h3>{template.name} · 샘플 책</h3><p>{template.description}</p><div className={styles.badges}>{template.useCases.map(x=><span key={x}>{x}</span>)}</div></div>{onClose?<button type="button" className={styles.close} onClick={onClose}>닫기</button>:null}</header>
    <div className={styles.stream}>{template.samplePages.map((page,index)=><article key={page.id} className={`${styles.page} ${page.type==="cover"?styles.cover:""}`} style={style} data-heading={heading} data-body={body} data-spacing={spacing} data-width={width} data-chapter={chapter} data-quote={quote} data-page-type={page.type}>
      {page.kicker?<span className={styles.kicker}>{page.kicker}</span>:null}
      {page.type!=="quote"?<h2 className={page.type==="toc"?styles.tocTitle:styles.title}>{page.title}</h2>:null}
      {page.type!=="quote"&&page.subtitle?<p className={styles.subtitle}>{page.subtitle}</p>:null}
      {page.type==="chapter"?<div className={styles.rule}/>:null}
      {page.items?.length?<ol className={styles.items}>{page.items.map(item=><li key={item}>{item}</li>)}</ol>:null}
      {page.body?.length?<div className={styles.body}>{page.body.map(x=><p key={x}>{x}</p>)}</div>:null}
      {page.type==="quote"?<div className={styles.quote}>{page.title}</div>:null}
      {page.table?.length?<table className={styles.table}><tbody>{page.table.map(([k,v])=><tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>:null}
      <span className={styles.foot}>AI BOOK STUDIO · {String(index+1).padStart(2,"0")}</span>
    </article>)}</div>
  </section>;
}
