import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ExportBook } from "./collect";
import { stripMarkdown } from "./collect";

export async function renderBookDocx(book:ExportBook){
  const children:Paragraph[]=[new Paragraph({heading:HeadingLevel.TITLE,children:[new TextRun({text:book.title,bold:true})]}),...(book.subtitle?[new Paragraph({children:[new TextRun(book.subtitle)]})]:[])];
  for(const part of book.parts){children.push(new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun(part.title)]}));for(const chapter of part.chapters){children.push(new Paragraph({heading:HeadingLevel.HEADING_2,children:[new TextRun(chapter.title)]}));for(const section of chapter.sections){children.push(new Paragraph({heading:HeadingLevel.HEADING_3,children:[new TextRun(section.title)]}));for(const paragraph of stripMarkdown(section.content_markdown??"").split(/\n{2,}/).filter(Boolean)){children.push(new Paragraph({children:[new TextRun(paragraph)],spacing:{after:180,line:360}}));}}}}
  const doc=new Document({creator:"AI Book Studio",title:book.title,description:book.subtitle??undefined,sections:[{properties:{},children}]});
  return Packer.toBuffer(doc);
}
