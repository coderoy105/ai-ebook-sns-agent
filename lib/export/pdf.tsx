import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ExportBook } from "./collect";
import { stripMarkdown } from "./collect";

let fontsRegistered=false;
function registerFonts(){
  if(fontsRegistered)return;
  Font.register({family:"BookKR",fonts:[
    {src:process.env.PDF_FONT_REGULAR_URL??"https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@latest/files/noto-sans-kr-korean-400-normal.woff",fontWeight:400},
    {src:process.env.PDF_FONT_BOLD_URL??"https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@latest/files/noto-sans-kr-korean-700-normal.woff",fontWeight:700}
  ]});
  fontsRegistered=true;
}

const s=StyleSheet.create({
  page:{fontFamily:"BookKR",fontSize:10.5,lineHeight:1.72,paddingTop:52,paddingBottom:54,paddingHorizontal:48,color:"#23221f"},
  cover:{fontFamily:"BookKR",padding:58,backgroundColor:"#24342f",color:"#f7f1e7",justifyContent:"space-between"},
  kicker:{fontSize:9,letterSpacing:2,textTransform:"uppercase",opacity:.72},
  coverTitle:{fontSize:34,lineHeight:1.08,fontWeight:700,maxWidth:370},coverSub:{fontSize:13,lineHeight:1.55,maxWidth:360,opacity:.86},
  part:{fontSize:10,letterSpacing:1.4,color:"#8a4b3d",marginBottom:12},chapterTitle:{fontSize:26,lineHeight:1.1,fontWeight:700,marginBottom:16},
  section:{marginBottom:16},sectionTitle:{fontSize:15,fontWeight:700,marginBottom:8},paragraph:{marginBottom:8},
  tocTitle:{fontSize:28,fontWeight:700,marginBottom:28},tocPart:{fontSize:12,fontWeight:700,marginTop:14,marginBottom:5},tocChapter:{fontSize:10,marginLeft:14,marginBottom:3,color:"#55524d"},
  footer:{position:"absolute",bottom:24,left:48,right:48,display:"flex",flexDirection:"row",justifyContent:"space-between",fontSize:8,color:"#8a877f"}
});

function Footer({title}:{title:string}){return <View style={s.footer} fixed><Text>{title}</Text><Text render={({pageNumber})=>String(pageNumber)} /></View>}
function Paragraphs({markdown}:{markdown:string}){return <>{stripMarkdown(markdown).split(/\n{2,}/).filter(Boolean).map((p,i)=><Text key={i} style={s.paragraph}>{p}</Text>)}</>}

function BookPdf({book}:{book:ExportBook}){
  return <Document title={book.title} author="AI Book Studio" language="ko-KR">
    <Page size="A5" style={s.cover}><Text style={s.kicker}>{book.book_type}</Text><View><Text style={s.coverTitle}>{book.title}</Text>{book.subtitle&&<Text style={s.coverSub}>{book.subtitle}</Text>}</View><Text style={s.kicker}>AI BOOK STUDIO</Text></Page>
    <Page size="A5" style={s.page}><Text style={s.tocTitle}>Contents</Text>{book.parts.map(part=><View key={part.id}><Text style={s.tocPart}>{part.title}</Text>{part.chapters.map(ch=><Text key={ch.id} style={s.tocChapter}>{String(ch.position+1).padStart(2,"0")}  {ch.title}</Text>)}</View>)}<Footer title={book.title}/></Page>
    {book.parts.flatMap(part=>part.chapters.map(chapter=><Page key={chapter.id} size="A5" style={s.page} wrap><Text style={s.part}>{part.title.toUpperCase()}</Text><Text style={s.chapterTitle}>{chapter.title}</Text>{chapter.sections.map(section=><View key={section.id} style={s.section}><Text style={s.sectionTitle}>{section.title}</Text><Paragraphs markdown={section.content_markdown??""}/></View>)}<Footer title={book.title}/></Page>))}
  </Document>;
}

export async function renderBookPdf(book:ExportBook){registerFonts();return renderToBuffer(<BookPdf book={book}/>);}
