import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import type { ExportBook } from "./collect";
import { stripMarkdown } from "./collect";

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "BookKR",
    fonts: [
      {
        src: process.env.PDF_FONT_REGULAR_URL ?? "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@latest/files/noto-sans-kr-korean-400-normal.woff",
        fontWeight: 400
      },
      {
        src: process.env.PDF_FONT_BOLD_URL ?? "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-kr@latest/files/noto-sans-kr-korean-700-normal.woff",
        fontWeight: 700
      }
    ]
  });
  fontsRegistered = true;
}

const s = StyleSheet.create({
  page: {
    fontFamily: "BookKR",
    fontSize: 10.5,
    lineHeight: 1.72,
    paddingTop: 52,
    paddingBottom: 44,
    paddingHorizontal: 48,
    color: "#23221f"
  },
  cover: {
    fontFamily: "BookKR",
    padding: 58,
    backgroundColor: "#24342f",
    color: "#f7f1e7",
    justifyContent: "space-between"
  },
  kicker: { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", opacity: 0.72 },
  coverTitle: { fontSize: 34, lineHeight: 1.08, fontWeight: 700, maxWidth: 370 },
  coverSub: { fontSize: 13, lineHeight: 1.55, maxWidth: 360, opacity: 0.86, marginTop: 12 },
  part: { fontSize: 10, letterSpacing: 1.4, color: "#8a4b3d", marginBottom: 12 },
  chapterTitle: { fontSize: 24, lineHeight: 1.12, fontWeight: 700, marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 12 },
  paragraph: { marginBottom: 8 },
  tocTitle: { fontSize: 28, fontWeight: 700, marginBottom: 28 },
  tocPart: { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 5 },
  tocChapter: { fontSize: 10, marginLeft: 14, marginBottom: 3, color: "#55524d" },
  endMark: { marginTop: 18, fontSize: 8, color: "#8a877f" }
});

function Paragraphs({ markdown }: { markdown: string }) {
  const paragraphs = stripMarkdown(markdown)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return <>{paragraphs.map((paragraph, index) => <Text key={index} style={s.paragraph}>{paragraph}</Text>)}</>;
}

function FrontMatterPdf({ book }: { book: ExportBook }) {
  return (
    <Document title={book.title} author="AI Book Studio" language="ko-KR">
      <Page size="A5" style={s.cover}>
        <Text style={s.kicker}>{book.book_type}</Text>
        <View>
          <Text style={s.coverTitle}>{book.title}</Text>
          {book.subtitle && <Text style={s.coverSub}>{book.subtitle}</Text>}
        </View>
        <Text style={s.kicker}>AI BOOK STUDIO</Text>
      </Page>
      <Page size="A5" style={s.page} wrap>
        <Text style={s.tocTitle}>Contents</Text>
        {book.parts.map((part) => (
          <View key={part.id} wrap={false}>
            <Text style={s.tocPart}>{part.title}</Text>
            {part.chapters.map((chapter) => (
              <Text key={chapter.id} style={s.tocChapter}>
                {String(chapter.position + 1).padStart(2, "0")}  {chapter.title}
              </Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

function ChapterPdf({
  book,
  part,
  chapter
}: {
  book: ExportBook;
  part: ExportBook["parts"][number];
  chapter: ExportBook["parts"][number]["chapters"][number];
}) {
  return (
    <Document title={`${book.title} · ${chapter.title}`} author="AI Book Studio" language="ko-KR">
      {chapter.sections.map((section, sectionIndex) => (
        <Page key={section.id} size="A5" style={s.page} wrap>
          <Text style={s.part}>{part.title.toUpperCase()}</Text>
          {sectionIndex === 0 && <Text style={s.chapterTitle}>{chapter.title}</Text>}
          <Text style={s.sectionTitle}>{section.title}</Text>
          <Paragraphs markdown={section.content_markdown ?? ""} />
          <Text style={s.endMark}>{book.title}</Text>
        </Page>
      ))}
    </Document>
  );
}

function assertPdf(buffer: Buffer) {
  if (buffer.length < 5 || buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("PDF_RENDER_INVALID");
  }
}

async function appendPdf(target: PDFDocument, sourceBuffer: Buffer) {
  assertPdf(sourceBuffer);
  const source = await PDFDocument.load(sourceBuffer);
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((page) => target.addPage(page));
}

export type PdfRenderProgress = (progress: number, message: string) => void | Promise<void>;

export async function renderBookPdf(book: ExportBook, onProgress?: PdfRenderProgress) {
  registerFonts();
  const chapters = book.parts.flatMap((part) => part.chapters.map((chapter) => ({ part, chapter })));
  const target = await PDFDocument.create();
  target.setTitle(book.title);
  target.setAuthor("AI Book Studio");
  target.setCreator("AI Book Studio");

  await onProgress?.(4, "표지와 목차를 만들고 있습니다.");
  const front = await renderToBuffer(<FrontMatterPdf book={book} />);
  await appendPdf(target, front);
  await onProgress?.(10, "표지와 목차를 완성했습니다.");

  const total = Math.max(1, chapters.length);
  for (let index = 0; index < chapters.length; index += 1) {
    const { part, chapter } = chapters[index];
    const chunk = await renderToBuffer(<ChapterPdf book={book} part={part} chapter={chapter} />);
    await appendPdf(target, chunk);
    const chapterProgress = 10 + Math.round(((index + 1) / total) * 76);
    await onProgress?.(
      Math.min(86, chapterProgress),
      `Chapter ${index + 1}/${chapters.length} PDF를 만들고 있습니다.`
    );
  }

  await onProgress?.(90, "PDF 조각을 하나의 파일로 합치고 있습니다.");
  const bytes = await target.save({ useObjectStreams: true });
  const buffer = Buffer.from(bytes);
  assertPdf(buffer);
  return buffer;
}
