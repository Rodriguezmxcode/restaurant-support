import { parseProviSourceFiles } from './proviEvidence.js';
import { extractProviTextPdfPurchases } from './proviPdfText.js';

const extractionSchema = {
  type: 'object', additionalProperties: false, required: ['purchases'], properties: {
    purchases: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      required: ['location', 'orderDate', 'deliveryDate', 'vendor', 'orderNumber', 'orderedAmount', 'items', 'sourceNote', 'confidence'],
      properties: {
        location: { type: ['string', 'null'] }, orderDate: { type: ['string', 'null'] }, deliveryDate: { type: ['string', 'null'] },
        vendor: { type: ['string', 'null'] }, orderNumber: { type: ['string', 'null'] }, orderedAmount: { type: ['number', 'null'] },
        sourceNote: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        items: { type: 'array', maxItems: 250, items: { type: 'object', additionalProperties: false,
          required: ['name', 'distributor', 'quantity', 'spend'], properties: {
            name: { type: 'string' }, distributor: { type: 'string' }, quantity: { type: 'string' }, spend: { type: ['number', 'null'] },
          } } },
      },
    } },
  },
};

async function extractVisualEvidence(files: ReturnType<typeof parseProviSourceFiles>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('La lectura visual de fotos y PDF escaneados no está activa. Usa un PDF con texto o JSON.');
  const content: Record<string, unknown>[] = [{
    type: 'input_text',
    text: 'Extract Provi alcohol/beverage purchase evidence. Split the result into one purchase per distributor/vendor when a document contains multiple vendor orders. Use only what is visible in the files; never invent amounts, dates, order numbers, vendors, products, or locations. Allowed Puerto Vallarta locations are Stamford, Orange, Fairfield, Danbury, Avon, Southington. If the location is not visible, return null so the user can select it. orderDate and deliveryDate must be YYYY-MM-DD when visible. orderedAmount is the total for that vendor purchase. Preserve product names, distributor, quantity and line spend when visible. Explain uncertainty briefly in sourceNote.',
  }];
  for (const file of files) {
    const dataUrl = `data:${file.mime};base64,${file.data}`;
    content.push(file.mime === 'application/pdf'
      ? { type: 'input_file', filename: file.name, file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl, detail: 'high' });
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPSVISTA_DOCUMENT_MODEL || 'gpt-5.2',
      store: false,
      max_output_tokens: 5000,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'provi_purchase_evidence', strict: true, schema: extractionSchema } },
    }),
  });
  const body = await response.json() as any;
  if (!response.ok) {
    const message = String(body?.error?.message || 'No se pudo leer la evidencia de Provi.');
    if (/quota|credit|billing|insufficient/i.test(message)) throw new Error('La lectura visual de fotos/PDF escaneados no tiene créditos disponibles. Los PDF con texto y JSON siguen funcionando sin usar la API.');
    throw new Error(message);
  }
  const outputText = typeof body.output_text === 'string'
    ? body.output_text
    : body.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error('El lector visual no devolvió datos utilizables.');
  const raw = JSON.parse(outputText) as { purchases?: Record<string, unknown>[] };
  if (!Array.isArray(raw.purchases) || !raw.purchases.length) throw new Error('No se identificó ninguna compra en la evidencia.');
  return { purchases: raw.purchases, fileCount: files.length, extractionMode: 'visual-api' as const };
}

export async function extractProviEvidence(filesInput: unknown) {
  const files = parseProviSourceFiles(filesInput);
  const allPdf = files.every(file => file.mime === 'application/pdf');
  if (allPdf) return extractProviTextPdfPurchases(files);
  if (files.some(file => file.mime === 'application/pdf')) throw new Error('Para evitar cargos innecesarios, sube los PDF y las fotos por separado. Los PDF con texto se leen localmente sin usar créditos.');
  return extractVisualEvidence(files);
}
