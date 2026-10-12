import { inflateRawSync, inflateSync } from 'node:zlib';
import { beverageLocations, money } from '../shared/beverageMetrics.js';
import type { ProviSourceFile } from '../shared/proviEvidence.js';

export type PdfTextPurchase = {
  location: string | null;
  orderDate: string | null;
  deliveryDate: string | null;
  vendor: string | null;
  orderNumber: string | null;
  orderedAmount: number | null;
  items: Array<{ name: string; distributor: string; quantity: string; spend: number | null }>;
  sourceNote: string;
  confidence: number;
};

const knownVendors = [
  'Brescome Barton Inc.',
  'Connecticut Distributors Inc.',
  'Eder-Goodman Fine Wine and Spirits',
  'Martignetti Companies - CT',
  'Northeast Beverage of Connecticut',
  'Star Distributors Inc. - Connecticut',
  'Allan S Goodman Inc',
  'Hartford Distributors, Inc.',
  'Dichello Distributors Inc',
] as const;

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripStreamEdges = (value: Buffer) => {
  let start = 0, end = value.length;
  while (start < end && (value[start] === 10 || value[start] === 13)) start++;
  while (end > start && (value[end - 1] === 10 || value[end - 1] === 13)) end--;
  return value.subarray(start, end);
};

function decodePdfBytes(bytes: Buffer) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2), swapped = Buffer.alloc(body.length - (body.length % 2));
    for (let index = 0; index + 1 < body.length; index += 2) { swapped[index] = body[index + 1]; swapped[index + 1] = body[index]; }
    return swapped.toString('utf16le');
  }
  return bytes.toString('latin1').replace(/\0/g, '');
}

function decodeLiteral(value: string) {
  const out: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index) & 0xff;
    if (code !== 92) { out.push(code); continue; }
    index++;
    if (index >= value.length) break;
    const next = value[index];
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (escapes[next] !== undefined) { out.push(escapes[next]); continue; }
    if (next === '\n' || next === '\r') { if (next === '\r' && value[index + 1] === '\n') index++; continue; }
    if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && index + 1 < value.length && /[0-7]/.test(value[index + 1])) octal += value[++index];
      out.push(parseInt(octal, 8) & 0xff); continue;
    }
    out.push(next.charCodeAt(0) & 0xff);
  }
  return decodePdfBytes(Buffer.from(out));
}

function textFromContentStream(content: string) {
  const blocks = content.match(/BT[\s\S]*?ET/g) || [];
  const lines: string[] = [];
  for (const block of blocks) {
    const tokens: string[] = [];
    const tokenPattern = /\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]{2,})>/g;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(block))) {
      const raw = match[0];
      if (raw.startsWith('(')) tokens.push(decodeLiteral(raw.slice(1, -1)));
      else {
        const hex = (match[1] || '').replace(/\s/g, '');
        if (hex.length >= 2) tokens.push(decodePdfBytes(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex')));
      }
    }
    const line = tokens.join(' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

export function extractEmbeddedPdfText(data: string) {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < 8 || !bytes.subarray(0, 8).toString('latin1').includes('%PDF-')) throw new Error('El archivo no parece ser un PDF válido.');
  const source = bytes.toString('latin1');
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const marker = source.indexOf('stream', cursor);
    if (marker < 0) break;
    const afterMarker = marker + 6;
    const separator = source.startsWith('\r\n', afterMarker) ? 2 : source[afterMarker] === '\n' || source[afterMarker] === '\r' ? 1 : 0;
    if (!separator) { cursor = afterMarker; continue; }
    const start = afterMarker + separator, end = source.indexOf('endstream', start);
    if (end < 0) break;
    const dictStart = source.lastIndexOf('<<', marker), dictEnd = source.indexOf('>>', dictStart >= 0 ? dictStart : marker);
    const dict = dictStart >= 0 && dictEnd >= 0 && dictEnd < marker ? source.slice(dictStart, dictEnd + 2) : '';
    let stream = stripStreamEdges(bytes.subarray(start, end));
    try {
      if (/\/FlateDecode\b/.test(dict)) {
        try { stream = inflateSync(stream); } catch { stream = inflateRawSync(stream); }
      } else if (/\/Filter\b/.test(dict)) { cursor = end + 9; continue; }
      const text = textFromContentStream(stream.toString('latin1'));
      if (text) chunks.push(text);
    } catch { /* Unsupported stream: continue with other text streams. */ }
    cursor = end + 9;
  }
  const direct = textFromContentStream(source);
  if (direct) chunks.push(direct);
  return chunks.join('\n').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const iso = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const us = value.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    const candidate = `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    if (Number.isFinite(Date.parse(`${candidate}T00:00:00Z`))) return candidate;
  }
  const names: Record<string, string> = { jan:'01',january:'01',feb:'02',february:'02',mar:'03',march:'03',apr:'04',april:'04',may:'05',jun:'06',june:'06',jul:'07',july:'07',aug:'08',august:'08',sep:'09',sept:'09',september:'09',oct:'10',october:'10',nov:'11',november:'11',dec:'12',december:'12' };
  const named = value.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
  if (named) return `${named[3]}-${names[named[1].toLowerCase()]}-${named[2].padStart(2, '0')}`;
  return null;
}

const amountValue = (value: string | undefined) => {
  if (!value) return null;
  const number = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(number) && number >= 0 ? money(number) : null;
};

function findLabeledDate(text: string, labels: RegExp) {
  const match = text.match(new RegExp(`${labels.source}[^\\n]{0,45}?((?:20\\d{2}-\\d{1,2}-\\d{1,2})|(?:\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4})|(?:[A-Za-z]{3,9}\\s+\\d{1,2}(?:st|nd|rd|th)?[,]?\\s+20\\d{2}))`, 'i'));
  return parseDate(match?.[1]);
}

function findOrderNumber(text: string) {
  const patterns = [
    /(?:order|purchase order|confirmation|po)\s*(?:number|no\.?|#|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{3,})/i,
    /(?:reference|ref)\s*(?:number|no\.?|#|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9_-]{3,})/i,
  ];
  for (const pattern of patterns) { const match = text.match(pattern); if (match) return match[1]; }
  return null;
}

function findTotal(text: string) {
  const labels = [
    /grand\s+total/i, /order\s+total/i, /estimated\s+total/i, /purchase\s+total/i,
    /total\s+amount/i, /amount\s+due/i, /\btotal\b/i,
  ];
  for (const label of labels) {
    const match = text.match(new RegExp(`${label.source}[^\\n$0-9]{0,24}\\$?\\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{2})|[0-9]+(?:\\.[0-9]{2}))`, 'i'));
    const value = amountValue(match?.[1]);
    if (value !== null) return { value, inferred: false };
  }
  const currencies = [...text.matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})|[0-9]+(?:\.\d{2}))/g)]
    .map(match => amountValue(match[1])).filter((value): value is number => value !== null);
  if (currencies.length) return { value: Math.max(...currencies), inferred: true };
  return { value: null, inferred: false };
}

function detectedVendors(text: string) {
  const haystack = normalized(text);
  return knownVendors.filter(vendor => {
    const key = normalized(vendor).replace(/\b(?:inc|ct|connecticut|companies)\b/g, '').replace(/\s+/g, ' ').trim();
    return key.length >= 5 && haystack.includes(key);
  });
}

function labeledVendor(text: string) {
  const line = text.split(/\n/).find(value => /\b(?:vendor|distributor|supplier|sold by|fulfilled by)\b/i.test(value));
  if (!line) return null;
  const match = line.match(/(?:vendor|distributor|supplier|sold by|fulfilled by)\s*[:#-]?\s*(.{2,80})$/i);
  return match?.[1]?.trim().replace(/\s{2,}.*/, '') || null;
}

function locationFromText(text: string) {
  const key = normalized(text);
  return beverageLocations.find(location => new RegExp(`\\b${normalized(location)}\\b`).test(key)) || null;
}

function parseTextPurchase(text: string, vendor: string | null, suppressTotal = false, extraNote = ''): PdfTextPurchase {
  const location = locationFromText(text);
  const orderDate = findLabeledDate(text, /(?:order(?:ed)?\s+date|date\s+ordered|order\s+placed|placed\s+on|purchase\s+date|fecha\s+de\s+orden)/i)
    || parseDate(text.match(/(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2})/)?.[0]);
  const deliveryDate = findLabeledDate(text, /(?:delivery\s+date|deliver(?:y|ed)\s+on|expected\s+delivery|fecha\s+de\s+entrega)/i);
  const total = suppressTotal ? { value: null, inferred: false } : findTotal(text);
  const orderNumber = findOrderNumber(text);
  const actualVendor = vendor || labeledVendor(text);
  const score = Math.min(0.9, 0.15 + (location ? 0.15 : 0) + (orderDate ? 0.2 : 0) + (actualVendor ? 0.2 : 0) + (total.value !== null ? 0.25 : 0) + (orderNumber ? 0.05 : 0));
  const missing = [!location && 'locación', !orderDate && 'fecha', !actualVendor && 'distribuidor', total.value === null && 'total'].filter(Boolean).join(', ');
  const notes = ['PDF leído localmente sin usar créditos de API.'];
  if (total.inferred) notes.push('El total se estimó usando el importe monetario más alto visible; confirma el valor.');
  if (extraNote) notes.push(extraNote);
  if (missing) notes.push(`Completa o confirma: ${missing}.`);
  return { location, orderDate, deliveryDate, vendor: actualVendor, orderNumber, orderedAmount: total.value, items: [], sourceNote: notes.join(' '), confidence: money(score) };
}

export function extractProviTextPdfPurchases(files: ProviSourceFile[]) {
  const pdfs = files.filter(file => file.mime === 'application/pdf');
  if (!pdfs.length || pdfs.length !== files.length) throw new Error('La lectura local gratuita solo procesa PDF. Sube las fotos por separado.');
  const purchases: PdfTextPurchase[] = [];
  for (const file of pdfs) {
    const text = extractEmbeddedPdfText(file.data);
    if (text.replace(/\s/g, '').length < 24) throw new Error(`${file.name}: este PDF parece escaneado como imagen o usa una codificación que no contiene texto legible. Para este archivo usa JSON o el lector visual cuando esté activo.`);
    const vendors = detectedVendors(text);
    if (vendors.length > 1) {
      for (const vendor of vendors) purchases.push(parseTextPurchase(text, vendor, true, 'Se detectaron varios distribuidores en el mismo PDF. Confirma manualmente el total correspondiente a este distribuidor para evitar duplicar el total general.'));
    } else purchases.push(parseTextPurchase(text, vendors[0] || null));
  }
  return { purchases, fileCount: pdfs.length, extractionMode: 'pdf-text' as const };
}
