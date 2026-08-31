import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import type { ExportBook } from "./collect";
import { stripMarkdown } from "./collect";
import type { CoverConcept } from "@/lib/design/cover-system";

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
  Font.register({
    family: "BookSerifKR",
    fonts: [
      {
        src: process.env.PDF_FONT_SERIF_REGULAR_URL ?? "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-kr@latest/files/noto-serif-kr-korean-400-normal.woff",
        fontWeight: 400
      },
      {
        src: process.env.PDF_FONT_SERIF_BOLD_URL ?? "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-kr@latest/files/noto-serif-kr-korean-700-normal.woff",
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
    paddingTop: 35,
    paddingBottom: 32,
    paddingLeft: 42,
    paddingRight: 38,
    justifyContent: "space-between"
  },
  coverHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  coverKicker: { fontFamily: "BookKR", fontSize: 7.2, letterSpacing: 1.55, fontWeight: 700 },
  coverCatalogue: { fontFamily: "BookKR", fontSize: 6.5, letterSpacing: 1.15, opacity: 0.52 },
  coverArt: { height: 190, marginTop: 18, marginBottom: 18, justifyContent: "center" },
  coverTitleBlock: { maxWidth: 365 },
  coverMotif: { fontFamily: "BookKR", fontSize: 7.2, letterSpacing: 1.2, fontWeight: 700, marginBottom: 11 },
  coverTitle: { fontSize: 31, lineHeight: 1.07, fontWeight: 700, maxWidth: 365 },
  coverTitleLarge: { fontSize: 37, lineHeight: 1.01 },
  coverTitleLong: { fontSize: 26, lineHeight: 1.11 },
  coverSub: { fontFamily: "BookKR", fontSize: 10.2, lineHeight: 1.52, maxWidth: 315, opacity: 0.76, marginTop: 13, paddingTop: 9, borderTopWidth: 0.6 },
  coverFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  coverImprintGroup: { flexDirection: "row", alignItems: "center", gap: 7 },
  coverImprintMark: { width: 9, height: 9, borderWidth: 0.7, transform: "rotate(45deg)" },
  coverMeta: { fontFamily: "BookKR", fontSize: 6.5, letterSpacing: 1.05, fontWeight: 700 },
  coverEdition: { fontFamily: "BookKR", fontSize: 6.2, letterSpacing: 0.95, opacity: 0.52 },
  artFrame: { height: 132, borderWidth: 1.2, marginHorizontal: 48 },
  artBlock: { width: 105, height: 148, alignSelf: "flex-end", marginRight: 38 },
  artLine: { height: 1.2, marginBottom: 13 },
  artOrbit: { width: 132, height: 132, borderRadius: 66, borderWidth: 1.5, alignSelf: "center" },
  artDotRow: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", paddingHorizontal: 35 },
  artDot: { width: 9, height: 9, borderRadius: 5 },
  artDotSmall: { width: 4.5, height: 4.5, borderRadius: 3 },
  artStack: { width: 170, height: 92, borderWidth: 1.2, alignSelf: "center" },
  artStackOffset: { width: 170, height: 92, borderWidth: 1.2, alignSelf: "center", marginTop: -76, marginLeft: 24 },
  artHorizon: { height: 0.8, marginHorizontal: 15 },
  artWindow: { height: 138, width: 180, borderWidth: 11, borderLeftWidth: 1.5, alignSelf: "center" },
  artCutRow: { flexDirection: "row", gap: 14, justifyContent: "center", transform: "rotate(-5deg)" },
  artCutA: { width: 112, height: 112 },
  artCutB: { width: 92, height: 92, marginTop: 34 },
  artWord: { fontSize: 31, fontWeight: 700, letterSpacing: -1.1, textAlign: "center", opacity: 0.9 },
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

function CoverArtwork({ concept }: { concept: CoverConcept }) {
  const { accent, secondary, foreground, background } = concept.palette;
  switch (concept.composition) {
    case "threshold":
      return <View style={s.coverArt}><View style={[s.artFrame, { borderColor: accent, marginLeft: 145, marginRight: 30 }]}><View style={{ width: 20, height: 55, backgroundColor: secondary, marginLeft: 28, marginTop: 28 }} /></View></View>;
    case "orbit":
      return <View style={s.coverArt}><View style={[s.artOrbit, { borderColor: foreground }]}><View style={{ width: 98, height: 98, borderRadius: 49, backgroundColor: accent, marginLeft: 54, marginTop: 38 }} /><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: secondary, marginLeft: 88, marginTop: -122 }} /></View></View>;
    case "signal":
      return <View style={s.coverArt}><View style={[s.artLine, { backgroundColor: accent, width: "82%", height: 1.8 }]} /><View style={[s.artLine, { backgroundColor: secondary, width: "48%", marginLeft: 28 }]} /><View style={[s.artLine, { backgroundColor: foreground, width: "67%", marginLeft: 8, opacity: 0.5 }]} /><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent, marginLeft: 138, marginTop: -35 }} /><View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: foreground, marginLeft: 245, marginTop: 14 }} /></View>;
    case "archive":
      return <View style={s.coverArt}><View style={[s.artStack, { borderColor: foreground }]} /><View style={[s.artStackOffset, { borderColor: accent, backgroundColor: accent, opacity: 0.7 }]} /><View style={[s.artStackOffset, { borderColor: secondary, marginLeft: 48, backgroundColor: background }]} /></View>;
    case "horizon":
      return <View style={s.coverArt}><View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: accent, alignSelf: "flex-end", marginRight: 58, marginBottom: -37 }} /><View style={[s.artHorizon, { backgroundColor: foreground }]} /></View>;
    case "monolith":
      return <View style={s.coverArt}><View style={{ width: 105, height: 148, alignSelf: "flex-end", marginRight: 58, borderWidth: 1, borderColor: foreground, opacity: .4 }} /><View style={[s.artBlock, { backgroundColor: accent, marginTop: -132 }]} /><View style={{ height: 1, backgroundColor: foreground, width: 150, marginTop: -55, marginLeft: 32, opacity: 0.45 }} /></View>;
    case "thread":
      return <View style={s.coverArt}><View style={{ height: 1.3, backgroundColor: accent, width: "84%", transform: "rotate(10deg)", marginLeft: 20 }} /><View style={{ height: 1.3, backgroundColor: secondary, width: "78%", transform: "rotate(-9deg)", marginLeft: 42, marginTop: 34 }} /><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent, marginLeft: 72, marginTop: -27 }} /><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: secondary, marginLeft: 258, marginTop: 8 }} /></View>;
    case "constellation":
      return <View style={s.coverArt}><View style={s.artDotRow}><View style={[s.artDot, { backgroundColor: accent }]} /><View style={[s.artDotSmall, { backgroundColor: foreground }]} /><View style={[s.artDot, { backgroundColor: secondary }]} /><View style={[s.artDotSmall, { backgroundColor: accent }]} /></View><View style={{ height: 1, backgroundColor: foreground, width: 190, alignSelf: "center", transform: "rotate(12deg)", opacity: 0.38 }} /><View style={{ height: 1, backgroundColor: foreground, width: 155, alignSelf: "center", transform: "rotate(-19deg)", opacity: 0.2, marginTop: -4 }} /></View>;
    case "window":
      return <View style={s.coverArt}><View style={[s.artWindow, { borderColor: accent, backgroundColor: secondary }]}><View style={{ width: 88, height: 72, borderWidth: 1, borderColor: background, marginLeft: 34, marginTop: 21 }} /></View></View>;
    case "cut-paper":
      return <View style={s.coverArt}><View style={s.artCutRow}><View style={[s.artCutA, { backgroundColor: secondary }]} /><View style={[s.artCutB, { backgroundColor: accent }]} /></View></View>;
    case "typographic":
      return <View style={s.coverArt}><View style={{ width: 18, height: 125, backgroundColor: accent, marginLeft: 38 }} /><Text style={[s.artWord, { color: foreground, marginTop: -84, marginLeft: 82, textAlign: "left" }]}>{concept.motifLabel}</Text></View>;
    case "field":
      return <View style={s.coverArt}>{[0,1,2,3,4].map((index) => <View key={index} style={{ height: 1, backgroundColor: index === 2 ? accent : foreground, opacity: index === 2 ? 0.78 : 0.14, marginBottom: 17, marginHorizontal: index * 7 }} />)}</View>;
    default:
      return <View style={s.coverArt}><View style={[s.artFrame, { borderColor: accent }]} /></View>;
  }
}

function CoverTitleBlock({ book, centered }: { book: ExportBook; centered: boolean }) {
  const cover = book.cover;
  const titleFamily = cover.typography.family === "serif" ? "BookSerifKR" : "BookKR";
  const titleLength = book.title.replace(/\s+/g, "").length;
  const quiet = cover.layout === "quiet-literary";
  return (
    <View style={[s.coverTitleBlock, centered ? { alignItems: "center", alignSelf: "center" } : {}]}>
      <Text style={[s.coverMotif, { color: quiet ? cover.palette.foreground : cover.palette.accent, opacity: quiet ? 0.55 : 1 }, centered ? { textAlign: "center" } : {}]}>{cover.motifLabel}</Text>
      <Text style={[
        s.coverTitle,
        cover.typography.titleScale === "xlarge" ? s.coverTitleLarge : {},
        titleLength >= 22 ? s.coverTitleLong : {},
        quiet ? { lineHeight: 1.16 } : {},
        { fontFamily: titleFamily, color: cover.palette.foreground },
        centered ? { textAlign: "center" } : {}
      ]}>{book.title}</Text>
      {book.subtitle && <Text style={[s.coverSub, { color: cover.palette.foreground, borderTopColor: cover.palette.foreground }, quiet ? { borderTopWidth: 0, paddingTop: 0 } : {}, centered ? { textAlign: "center" } : {}]}>{book.subtitle}</Text>}
    </View>
  );
}

function FrontMatterPdf({ book }: { book: ExportBook }) {
  const cover = book.cover;
  const centered = cover.typography.alignment === "center" || cover.layout === "quiet-literary";
  const poster = cover.layout === "poster";
  const quiet = cover.layout === "quiet-literary";
  return (
    <Document title={book.title} author="AI Book Studio" language="ko-KR">
      <Page size="A5" style={[s.cover, { backgroundColor: cover.palette.background, color: cover.palette.foreground }]}>
        <View style={s.coverHeader}>
          <Text style={s.coverKicker}>{cover.kicker}</Text>
          <Text style={s.coverCatalogue}>{cover.catalogue}</Text>
        </View>

        {poster ? <CoverTitleBlock book={book} centered={false} /> : null}
        <View style={quiet ? { opacity: 0.72 } : {}}><CoverArtwork concept={cover} /></View>
        {!poster ? <CoverTitleBlock book={book} centered={centered} /> : null}

        <View style={s.coverFooter}>
          <View style={s.coverImprintGroup}>
            <View style={[s.coverImprintMark, { borderColor: cover.palette.foreground }]} />
            <Text style={s.coverMeta}>{cover.imprint}</Text>
          </View>
          <Text style={s.coverEdition}>{cover.editionLabel}</Text>
        </View>
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

function chapterEntries(book: ExportBook) {
  return book.parts.flatMap((part) => part.chapters.map((chapter) => ({ part, chapter })));
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

export function pdfChapterCount(book: ExportBook) {
  return chapterEntries(book).length;
}

export async function renderBookPdfFrontChunk(book: ExportBook) {
  registerFonts();
  const buffer = await renderToBuffer(<FrontMatterPdf book={book} />);
  assertPdf(buffer);
  return buffer;
}

export async function renderBookPdfChapterChunk(book: ExportBook, chapterIndex: number) {
  registerFonts();
  const chapters = chapterEntries(book);
  const entry = chapters[chapterIndex];
  if (!entry) throw new Error(`PDF_CHAPTER_NOT_FOUND:${chapterIndex}`);
  const buffer = await renderToBuffer(<ChapterPdf book={book} part={entry.part} chapter={entry.chapter} />);
  assertPdf(buffer);
  return buffer;
}

export async function mergeBookPdfChunks(title: string, chunks: Array<Buffer | Uint8Array>) {
  if (!chunks.length) throw new Error("PDF_CHUNKS_EMPTY");
  const target = await PDFDocument.create();
  target.setTitle(title);
  target.setAuthor("AI Book Studio");
  target.setCreator("AI Book Studio");

  for (const chunk of chunks) await appendPdf(target, Buffer.from(chunk));

  const bytes = await target.save({ useObjectStreams: true });
  const buffer = Buffer.from(bytes);
  assertPdf(buffer);
  return buffer;
}

export type PdfRenderProgress = (progress: number, message: string) => void | Promise<void>;

export async function renderBookPdf(book: ExportBook, onProgress?: PdfRenderProgress) {
  const chapters = chapterEntries(book);
  const chunks: Buffer[] = [];

  await onProgress?.(4, "선택한 표지와 목차를 만들고 있습니다.");
  chunks.push(await renderBookPdfFrontChunk(book));
  await onProgress?.(10, "표지와 목차를 완성했습니다.");

  const total = Math.max(1, chapters.length);
  for (let index = 0; index < chapters.length; index += 1) {
    chunks.push(await renderBookPdfChapterChunk(book, index));
    const chapterProgress = 10 + Math.round(((index + 1) / total) * 76);
    await onProgress?.(
      Math.min(86, chapterProgress),
      `Chapter ${index + 1}/${chapters.length} PDF를 만들고 있습니다.`
    );
  }

  await onProgress?.(90, "PDF 조각을 하나의 파일로 합치고 있습니다.");
  return mergeBookPdfChunks(book.title, chunks);
}
