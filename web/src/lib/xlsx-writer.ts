/** Minimal .xlsx writer (ZIP STORE) — no libraries. Sheets are RTL. */

export type XlsxStyle =
  | "title"
  | "section"
  | "header"
  | "time"
  | "data"
  | "dataAlt"
  | "muted"
  | "blank";

export type XlsxCell = {
  v: string;
  style?: XlsxStyle;
};

export type XlsxSheet = {
  name: string;
  rows: XlsxCell[][];
  colWidths?: number[];
  freeze?: number;
  merges?: string[];
};

const STYLE_INDEX: Record<XlsxStyle, number> = {
  blank: 0,
  title: 1,
  section: 2,
  header: 3,
  time: 4,
  data: 5,
  dataAlt: 6,
  muted: 7,
};

const CRCT = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRCT[(c ^ u8[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function u8(s: string): Uint8Array {
  return encoder.encode(s);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function w16(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >> 8) & 255);
}

function w32(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255);
}

type ZipFile = { name: string; data: Uint8Array };

function zipStore(files: ZipFile[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = u8(file.name);
    const crc = crc32(file.data);
    const local = concatBytes([
      Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
      w16(20),
      w16(0x0800),
      w16(0),
      w16(0),
      w16(0),
      w32(crc),
      w32(file.data.length),
      w32(file.data.length),
      w16(name.length),
      w16(0),
      name,
      file.data,
    ]);
    const central = concatBytes([
      Uint8Array.of(0x50, 0x4b, 0x01, 0x02),
      w16(20),
      w16(20),
      w16(0x0800),
      w16(0),
      w16(0),
      w16(0),
      w32(crc),
      w32(file.data.length),
      w32(file.data.length),
      w16(name.length),
      w16(0),
      w16(0),
      w16(0),
      w16(0),
      w32(0),
      w32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = concatBytes(centrals);
  const end = concatBytes([
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0),
    w16(files.length),
    w16(files.length),
    w32(cd.length),
    w32(offset),
    w16(0),
  ]);
  return concatBytes([...locals, cd, end]);
}

export function xmlEscape(value: string): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function colName(n: number): string {
  let s = "";
  let i = n + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, " ").trim() || "גיליון";
  if (base.length > 31) base = base.slice(0, 31);
  let out = base;
  let n = 2;
  while (used.has(out)) {
    const suffix = ` (${n})`;
    out = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(out);
  return out;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="11"/><name val="Arial"/></font>
<font><sz val="14"/><b/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><sz val="12"/><b/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><sz val="11"/><b/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><sz val="11"/><b/><name val="Consolas"/></font>
<font><sz val="11"/><color rgb="FF5A6155"/><name val="Arial"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3D4A3A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF5A6155"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF8A6A3A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7F3E8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEE8D8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FFC8C2AF"/></left>
<right style="thin"><color rgb="FFC8C2AF"/></right>
<top style="thin"><color rgb="FFC8C2AF"/></top>
<bottom style="thin"><color rgb="FFC8C2AF"/></bottom>
<diagonal/>
</border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(cell: XlsxCell | undefined, ref: string): string {
  if (!cell) return "";
  const style = cell.style ?? "data";
  const s = STYLE_INDEX[style];
  if (style === "blank" || cell.v === "") {
    return s ? `<c r="${ref}" s="${s}"/>` : "";
  }
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.v)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet, selected: boolean): string {
  const cols =
    sheet.colWidths && sheet.colWidths.length
      ? `<cols>${sheet.colWidths
          .map(
            (w, i) =>
              `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";
  const pane = sheet.freeze
    ? `<pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
    : "";
  const rows = sheet.rows
    .map((cells, ri) => {
      const body = cells
        .map((c, ci) => cellXml(c, `${colName(ci)}${ri + 1}`))
        .join("");
      const ht =
        cells.some((c) => c.style === "title" || c.style === "section" || c.style === "header")
          ? ` ht="22" customHeight="1"`
          : "";
      return `<row r="${ri + 1}"${ht}>${body}</row>`;
    })
    .join("");
  const merges =
    sheet.merges && sheet.merges.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
          .map((m) => `<mergeCell ref="${m}"/>`)
          .join("")}</mergeCells>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView rightToLeft="1"${selected ? ' tabSelected="1"' : ""} workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>${cols}
<sheetData>${rows}</sheetData>${merges}
</worksheet>`;
}

export function writeXlsx(sheets: XlsxSheet[]): Uint8Array {
  if (!sheets.length) {
    throw new Error("writeXlsx: no sheets");
  }
  const used = new Set<string>();
  const named = sheets.map((sh) => ({
    ...sh,
    name: sanitizeSheetName(sh.name, used),
  }));
  const files: ZipFile[] = [];
  const add = (name: string, str: string) => files.push({ name, data: u8(str) });

  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${named
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );
  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${named
      .map(
        (s, i) =>
          `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets>
</workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${named
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join("")}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  add("xl/styles.xml", STYLES_XML);
  named.forEach((sh, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, i === 0)));
  return zipStore(files);
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function triggerBrowserDownload(
  filename: string,
  bytes: Uint8Array,
  mime = XLSX_MIME,
): void {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
