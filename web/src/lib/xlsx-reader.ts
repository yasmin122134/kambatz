/** Minimal .xlsx reader — ZIP STORE/DEFLATE, shared strings + inlineStr. Node only. */

import { inflateRawSync } from "node:zlib";

export type XlsxSheetGrid = {
  name: string;
  rows: string[][];
};

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function decodeXml(value: string): string {
  return String(value ?? "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `<x:c>` / `</x:v>` → `<c>` / `</v>` so tag matchers stay simple. */
function stripTagNamespaces(xml: string): string {
  return xml.replace(/<\/?([A-Za-z_][\w.-]*):/g, (full) => (full.startsWith("</") ? "</" : "<"));
}

function unzipEntries(buf: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eo = -1;
  const min = Math.max(0, buf.length - 70_000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(view, i) === 0x06054b50) {
      eo = i;
      break;
    }
  }
  if (eo < 0) throw new Error("לא נראה כמו קובץ xlsx");

  const n = u16(view, eo + 10);
  const cdOff = u32(view, eo + 16);
  const out = new Map<string, Uint8Array>();
  let q = cdOff;
  const decoder = new TextDecoder();

  for (let k = 0; k < n; k++) {
    if (u32(view, q) !== 0x02014b50) break;
    const method = u16(view, q + 10);
    const flags = u16(view, q + 8);
    const csize = u32(view, q + 20);
    const nl = u16(view, q + 28);
    const el = u16(view, q + 30);
    const cl = u16(view, q + 32);
    const lho = u32(view, q + 42);
    const nameBytes = buf.subarray(q + 46, q + 46 + nl);
    const name =
      flags & 0x800
        ? decoder.decode(nameBytes)
        : Array.from(nameBytes, (b) => String.fromCharCode(b)).join("");
    const lnl = u16(view, lho + 26);
    const lel = u16(view, lho + 28);
    const st = lho + 30 + lnl + lel;
    const compressed = buf.subarray(st, st + csize);
    let data: Uint8Array;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`שיטת דחיסה לא נתמכת בקובץ xlsx (${method})`);
    out.set(name.replace(/\\/g, "/").replace(/^\//, ""), data);
    q += 46 + nl + el + cl;
  }
  return out;
}

function textOf(xml: Uint8Array | undefined): string {
  if (!xml?.length) return "";
  return stripTagNamespaces(new TextDecoder().decode(xml).replace(/^\uFEFF/, ""));
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const sis = xml.match(/<si[\s>][\s\S]*?<\/si>/g) || [];
  for (const si of sis) {
    const parts = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
    out.push(
      decodeXml(
        parts
          .map((t) => t.replace(/<t(?:\s[^>]*)?>/, "").replace(/<\/t>/, ""))
          .join(""),
      ),
    );
  }
  return out;
}

function colIndex(ref: string): number {
  const m = /^\$?([A-Za-z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowIndex(ref: string): number {
  const m = /(\d+)$/.exec(ref.replace(/\$/g, ""));
  return m ? Number(m[1]) - 1 : 0;
}

function cellValue(cellXml: string, shared: string[]): string {
  const t = /\bt="([^"]+)"/.exec(cellXml)?.[1] || "";
  if (t === "inlineStr") {
    const inline = cellXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
    return inline ? decodeXml(inline[1]) : "";
  }
  const v = cellXml.match(/<v>([\s\S]*?)<\/v>/);
  if (!v) {
    const inline = cellXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
    return inline ? decodeXml(inline[1]) : "";
  }
  const raw = decodeXml(v[1]);
  if (t === "s") {
    const i = Number(raw);
    return Number.isFinite(i) ? shared[i] ?? "" : "";
  }
  return raw;
}

function parseSheetGrid(xml: string, shared: string[]): string[][] {
  const cells = xml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || [];
  const sparse: Record<number, Record<number, string>> = {};
  let maxR = -1;
  let maxC = -1;
  for (const cell of cells) {
    const ref = /\br="([^"]+)"/.exec(cell)?.[1];
    if (!ref) continue;
    const r = rowIndex(ref);
    const c = colIndex(ref);
    const value = cellValue(cell, shared).trim();
    if (!sparse[r]) sparse[r] = {};
    sparse[r][c] = value;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  const rows: string[][] = [];
  for (let r = 0; r <= maxR; r++) {
    const row: string[] = [];
    for (let c = 0; c <= maxC; c++) row.push(sparse[r]?.[c] ?? "");
    rows.push(row);
  }
  return rows;
}

function attr(xml: string, name: string): string {
  return new RegExp(`(?:\\b|:)${name}="([^"]*)"`).exec(xml)?.[1] ?? "";
}

function fileAt(files: Map<string, Uint8Array>, target: string): Uint8Array | undefined {
  const cleaned = target.replace(/\\/g, "/").replace(/^\//, "");
  return (
    files.get(cleaned) ||
    files.get(cleaned.replace(/^xl\//, "")) ||
    files.get(`xl/${cleaned.replace(/^xl\//, "")}`)
  );
}

export function readXlsxSheets(bytes: Uint8Array): XlsxSheetGrid[] {
  const files = unzipEntries(bytes);
  const shared = parseSharedStrings(textOf(files.get("xl/sharedStrings.xml")));
  const workbook = textOf(files.get("xl/workbook.xml"));
  const rels = textOf(files.get("xl/_rels/workbook.xml.rels"));
  const relMap = new Map<string, string>();
  for (const rel of rels.match(/<Relationship\b[^>]*\/?>/g) || []) {
    relMap.set(attr(rel, "Id"), attr(rel, "Target"));
  }

  const sheets: XlsxSheetGrid[] = [];
  const sheetTags = workbook.match(/<sheet\b[^>]*\/?>/g) || [];
  for (const tag of sheetTags) {
    const name = decodeXml(attr(tag, "name"));
    const rid = attr(tag, "id");
    const target = relMap.get(rid) || "";
    const xml = textOf(fileAt(files, target));
    if (!name || !xml) continue;
    sheets.push({ name, rows: parseSheetGrid(xml, shared) });
  }
  return sheets;
}
