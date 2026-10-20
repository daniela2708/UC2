/**
 * Minimal .xlsx writer (Office Open XML, one sheet, stored zip). No dependencies, no eval.
 * Displayed strings such as "$1,234", "38.6 %", "−0.3 pts" or "1,240 lb" are turned back into
 * numbers with a matching Excel number format, so downloaded values can be used in formulas.
 */

export type XCell = string | number | null;

export interface XSheet {
  title: string;
  subtitle?: string;
  head: string[];
  rows: XCell[][];
}

// Style indexes in styles.xml (cellXfs order below).
const S = { text: 0, head: 1, money: 2, money2: 3, pct: 4, pts: 5, int: 6, title: 7, dec: 8, note: 9 } as const;

export interface Parsed {
  v: string | number | null;
  s: number;
}

/** Turns a displayed value into a typed cell. Unparseable text stays text. */
export function parseCell(raw: XCell): Parsed {
  if (raw === null || raw === undefined) return { v: null, s: S.text };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { v: raw, s: Number.isInteger(raw) ? S.int : S.dec } : { v: null, s: S.text };
  const t = raw
    .replace(/[▲▼]/g, '')
    .replace(/−/g, '-')
    .replace(/[\u202f\u2009\u00a0]/g, ' ')
    .trim();
  if (t === '' || t === '—') return { v: null, s: S.text };
  const m = /^([+-])?\s*(\$)?\s*([+-])?(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?\s*([KMB])?\s*(%|pts|ea|lb|mo)?$/.exec(t);
  if (!m) return { v: raw, s: S.text };
  const sign = m[1] === '-' || m[3] === '-' ? -1 : 1;
  let n = Number(`${m[4].replace(/,/g, '')}${m[5] ?? ''}`) * sign;
  if (m[6]) n *= m[6] === 'K' ? 1e3 : m[6] === 'M' ? 1e6 : 1e9;
  const unit = m[7];
  if (unit === '%') return { v: n / 100, s: S.pct };
  if (unit === 'pts') return { v: n, s: S.pts };
  if (m[2]) return { v: n, s: m[5] && !m[6] ? S.money2 : S.money };
  if (unit === 'ea' || unit === 'lb') return { v: n, s: m[5] ? S.dec : S.int };
  return { v: n, s: m[5] ? S.dec : S.int };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(ref: string, p: Parsed): string {
  if (p.v === null) return p.s ? `<c r="${ref}" s="${p.s}"/>` : '';
  if (typeof p.v === 'number') return `<c r="${ref}" s="${p.s}"><v>${p.v}</v></c>`;
  return `<c r="${ref}" s="${p.s}" t="inlineStr"><is><t xml:space="preserve">${esc(p.v)}</t></is></c>`;
}

export function sheetXml(sheet: XSheet): string {
  const rows: string[] = [];
  let r = 1;
  const row = (cells: string) => rows.push(`<row r="${r}">${cells}</row>`);
  row(cellXml(`A${r}`, { v: sheet.title, s: S.title }));
  r++;
  if (sheet.subtitle) {
    row(cellXml(`A${r}`, { v: sheet.subtitle, s: S.note }));
    r++;
  }
  row(cellXml(`A${r}`, { v: 'Simulated data for prototype demonstration · as of 10/18/2026 (FY2026 W43)', s: S.note }));
  r += 2;
  const headRow = r;
  row(sheet.head.map((h, i) => cellXml(`${colName(i)}${r}`, { v: h, s: S.head })).join(''));
  r++;
  for (const cells of sheet.rows) {
    row(cells.map((c, i) => cellXml(`${colName(i)}${r}`, i === 0 && typeof c === 'string' ? { v: c, s: S.text } : parseCell(c))).join(''));
    r++;
  }
  const widths = sheet.head.map((h, i) => {
    let w = h.length;
    for (const cells of sheet.rows) w = Math.max(w, String(cells[i] ?? '').length);
    return Math.min(60, Math.max(10, w + 2));
  });
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const freeze = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${rows.join('')}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="+0.0&quot; pts&quot;;-0.0&quot; pts&quot;;0.0&quot; pts&quot;"/><numFmt numFmtId="168" formatCode="#,##0.0#"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF797873"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F0EA"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFA2A19C"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function workbookFiles(sheet: XSheet, sheetName: string): [string, string][] {
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Data');
  return [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(sheet)],
  ];
}

// ---------------------------------------------------------------- Zip (store method)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

export function buildXlsx(sheet: XSheet, sheetName = sheet.title): Uint8Array {
  return zipStore(workbookFiles(sheet, sheetName));
}

/** Builds the workbook and triggers a browser download. */
export function downloadXlsx(sheet: XSheet, fileBase: string): void {
  try {
    const bytes = buildXlsx(sheet);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'export'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('Excel export failed', err);
    window.alert('The export could not be created. Please try again.');
  }
}
