/**
 * Document processing (port of app/ingestion/document_processing.py):
 * text extraction from text files and PDFs (text layer first, OCR for
 * scanned pages), OCR of images in Arabic + English (Tesseract, compiled to
 * WebAssembly), and signature presence/similarity checks on scans.
 */
import type { Worker as TesseractWorker } from "tesseract.js";

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "gif"]);
export const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json"]);
export const AUDIO_VIDEO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "oga", "webm", "mp4", "mov", "mkv", "aac", "flac", "3gp"]);
export const MAX_OCR_PAGES = 40;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

/**
 * OCR keeps the scan's line breaks, so a sentence that wraps is read as two.
 * Join a line to the next when the next one continues the sentence (starts in lower case).
 */
export function joinWrappedLines(text: string): string {
  return text.replace(/([^\n.!?:؟])\n(?=[a-z؀-ۿ(])/g, "$1 ");
}

export interface Extracted {
  text: string;
  pages: string[];
  mean_confidence: number | null;
  method: string;
  page_count: number | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

let ocrWorker: Promise<TesseractWorker> | null = null;
export const ocrState = { loaded: false, loading: false, error: null as string | null };

function getOcr(): Promise<TesseractWorker> {
  if (!ocrWorker) {
    ocrState.loading = true;
    ocrWorker = import("tesseract.js").then(({ createWorker }) => createWorker(["ara", "eng"])).then(
      (w) => { Object.assign(ocrState, { loaded: true, loading: false, error: null }); return w; },
      (e) => { ocrWorker = null; Object.assign(ocrState, { loaded: false, loading: false, error: String(e?.message ?? e) }); throw e; },
    );
  }
  return ocrWorker;
}

async function ocrImage(image: Blob | HTMLCanvasElement): Promise<{ text: string; confidence: number }> {
  const worker = await getOcr();
  const { data } = await worker.recognize(image as any);
  return { text: (data.text || "").trim(), confidence: (data.confidence ?? 0) / 100 };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return lib;
}

async function renderPdfPage(pdf: any, pageNumber: number, scale = 2): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return canvas;
}

async function extractPdf(blob: Blob): Promise<Extracted> {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  const warnings: string[] = [];
  const confidences: number[] = [];
  let ocrPages = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = content.items.map((i: any) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join("").trim();
    if (text.length < 40) {
      if (ocrPages < MAX_OCR_PAGES) {
        ocrPages++;
        const ocr = await ocrImage(await renderPdfPage(pdf, n));
        text = joinWrappedLines(ocr.text);
        confidences.push(ocr.confidence);
      } else if (ocrPages === MAX_OCR_PAGES) {
        warnings.push(`Only the first ${MAX_OCR_PAGES} scanned pages were read by OCR.`);
        ocrPages++;
      }
    }
    pages.push(text);
  }
  return {
    text: pages.join("\n\n"), pages, page_count: pdf.numPages, warnings,
    mean_confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 1,
    method: confidences.length ? (confidences.length === pdf.numPages ? "ocr" : "pdf_text+ocr") : "pdf_text",
  };
}

export async function extractText(blob: Blob, filename: string): Promise<Extracted> {
  const ext = extensionOf(filename);
  if (TEXT_EXTENSIONS.has(ext) || blob.type.startsWith("text/")) {
    const text = await blob.text();
    return { text, pages: [text], mean_confidence: 1, method: "text", page_count: 1, warnings: [] };
  }
  if (ext === "pdf" || blob.type === "application/pdf") return extractPdf(blob);
  if (IMAGE_EXTENSIONS.has(ext) || blob.type.startsWith("image/")) {
    const { text: raw, confidence } = await ocrImage(blob);
    const text = joinWrappedLines(raw);
    const warnings = confidence < 0.6 && text ? ["OCR confidence is low; check the text against the original."] : [];
    return { text, pages: [text], mean_confidence: confidence, method: "ocr", page_count: 1, warnings };
  }
  throw new Error(`Automatic text extraction isn't available for .${ext} files.`);
}

// ---------------------------------------------------------------------------
// Signatures (document authentication -- a similarity score, never proof)
// ---------------------------------------------------------------------------

async function toGray(blob: Blob, lastPdfPage = true): Promise<{ w: number; h: number; px: Uint8ClampedArray }> {
  let canvas: HTMLCanvasElement;
  if (blob.type === "application/pdf") {
    const lib = await pdfjs();
    const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    canvas = await renderPdfPage(pdf, lastPdfPage ? pdf.numPages : 1, 1.5);
  } else {
    const bitmap = await createImageBitmap(blob);
    canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  }
  const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const px = new Uint8ClampedArray(width * height);
  for (let i = 0; i < px.length; i++) px[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return { w: width, h: height, px };
}

type Box = { x: number; y: number; w: number; h: number };

/** Largest ink cluster shaped like a signature (wide, not a text line block). */
function detectSignatureRegion(img: { w: number; h: number; px: Uint8ClampedArray }): Box | null {
  // Work on a downscaled ink mask with a small dilation so strokes join up.
  const step = Math.max(1, Math.round(Math.max(img.w, img.h) / 900));
  const W = Math.ceil(img.w / step), H = Math.ceil(img.h / step);
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < img.h; y += step) for (let x = 0; x < img.w; x += step) {
    if (img.px[y * img.w + x] < 200) ink[Math.floor(y / step) * W + Math.floor(x / step)] = 1;
  }
  const dil = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!ink[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W) dil[yy * W + xx] = 1;
    }
  }
  const seen = new Uint8Array(W * H);
  let best: { area: number; box: Box } | null = null;
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!dil[start] || seen[start]) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p - x) / W;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || seen[q] || !dil[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const w = (maxX - minX + 1) * step, h = (maxY - minY + 1) * step;
    const aspect = w / Math.max(h, 1);
    if (w * h >= 500 && aspect > 1.5 && aspect < 8 && (!best || w * h > best.area)) {
      best = { area: w * h, box: { x: minX * step, y: minY * step, w, h } };
    }
  }
  return best?.box ?? null;
}

/** Ink-density grid (30 x 15) of a region, as a zero-mean unit vector. */
function inkGrid(img: { w: number; px: Uint8ClampedArray }, box: Box): Float64Array {
  const GX = 30, GY = 15;
  const cells = new Float64Array(GX * GY);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    if (img.px[(box.y + y) * img.w + box.x + x] < 200) {
      cells[Math.min(GY - 1, Math.floor((y / box.h) * GY)) * GX + Math.min(GX - 1, Math.floor((x / box.w) * GX))]++;
    }
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  let norm = 0;
  for (let i = 0; i < cells.length; i++) { cells[i] -= mean; norm += cells[i] * cells[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < cells.length; i++) cells[i] /= norm;
  return cells;
}

export const SIGNATURE_MATCH_THRESHOLD = 0.5;

export async function verifySignature(document: Blob, reference: Blob | null) {
  const now = new Date().toISOString();
  const doc = await toGray(document, true);
  const region = detectSignatureRegion(doc);
  if (!region) {
    return { signature_present: false, match_score: null, flagged_for_human_review: true, checked_at: now,
             explanation: "No signature-like ink region was found. A clerk should inspect the original." };
  }
  if (!reference) {
    return { signature_present: true, match_score: null, flagged_for_human_review: false, checked_at: now,
             explanation: "A signature-like region is present. No reference signature was supplied, so no match was attempted." };
  }
  const ref = await toGray(reference, true);
  const refBox = detectSignatureRegion(ref) ?? { x: 0, y: 0, w: ref.w, h: ref.h };
  const a = inkGrid(doc, region), b = inkGrid(ref, refBox);
  let r = 0;
  for (let i = 0; i < a.length; i++) r += a[i] * b[i];
  const score = Math.round(Math.max(0, Math.min(1, r)) * 1000) / 1000;
  const flagged = score < SIGNATURE_MATCH_THRESHOLD;
  return {
    signature_present: true, match_score: score, flagged_for_human_review: flagged, checked_at: now,
    explanation: `Shape similarity to the reference is ${score.toFixed(2)} (threshold ${SIGNATURE_MATCH_THRESHOLD}). `
      + (flagged ? "Below threshold -- flagged for manual comparison by a clerk." : "Above threshold. This is a similarity score, not proof of authorship."),
  };
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
