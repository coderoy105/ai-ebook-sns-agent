import JSZip from "jszip";
import type { ExportBook } from "./collect";
import { stripMarkdown } from "./collect";

const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function paragraphs(markdown:string){return stripMarkdown(markdown).split(/\n{2,}/).filter(Boolean).map(p=>`<p>${esc(p)}</p>`).join("\n");}

export async function renderBookEpub(book:ExportBook){
  const zip=new JSZip();
  zip.file("mimetype","application/epub+zip",{compression:"STORE"});
  zip.file("META-INF/container.xml",`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const chapters=book.parts.flatMap(part=>part.chapters.map(ch=>({part,ch})));
  const manifest=chapters.map((_,i)=>`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine=chapters.map((_,i)=>`<itemref idref="c${i}"/>`).join("");
  zip.file("OEBPS/content.opf",`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${book.id}</dc:identifier><dc:title>${esc(book.title)}</dc:title><dc:language>ko</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/,"Z")}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest><spine>${spine}</spine></package>`);
  zip.file("OEBPS/nav.xhtml",`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Contents</h1><ol>${chapters.map(({ch},i)=>`<li><a href="c${i}.xhtml">${esc(ch.title)}</a></li>`).join("")}</ol></nav></body></html>`);
  chapters.forEach(({part,ch},i)=>zip.file(`OEBPS/c${i}.xhtml`,`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(ch.title)}</title><style>body{font-family:serif;line-height:1.75;margin:6%;max-width:42em}h1{line-height:1.2}h2{margin-top:2em}</style></head><body><small>${esc(part.title)}</small><h1>${esc(ch.title)}</h1>${ch.sections.map(sec=>`<section><h2>${esc(sec.title)}</h2>${paragraphs(sec.content_markdown??"")}</section>`).join("")}</body></html>`));
  return zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:7}});
}
