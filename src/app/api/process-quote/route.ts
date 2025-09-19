import { NextResponse, type NextRequest } from "next/server";
import OpenAI, { toFile } from "openai";
import type { QuoteExtraction } from "@/types/quote";
import { normalizeExtraction, quoteExtractionJsonSchema } from "@/lib/quoteSchema";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 15 * 1_024 * 1_024; // 15 MB
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
]);

const DEFAULT_MODEL = process.env.OPENAI_OCR_MODEL ?? "gpt-4.1-mini";

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Configura OPENAI_API_KEY antes de procesar documentos." },
      { status: 500 }
    );
  }

  try {
    const payload = await request.formData();
    const fileEntry = payload.get("file");

    if (!fileEntry || !(fileEntry instanceof File)) {
      return NextResponse.json({ error: "No se adjunto ningun archivo." }, { status: 400 });
    }

    if (fileEntry.size === 0) {
      return NextResponse.json({ error: "El archivo esta vacio." }, { status: 400 });
    }

    if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "El archivo supera el limite de 15 MB." }, { status: 400 });
    }

    const contentType = fileEntry.type || "application/octet-stream";
    if (!SUPPORTED_MIME_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: "Formato no soportado. Usa PDF o imagenes (png, jpg, webp, tiff)." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await fileEntry.arrayBuffer());

    const inputContent: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: [
          "Analiza el documento adjunto y extrae la informacion necesaria para elaborar una solicitud de cotizacion (RFQ).",
          "Completa todos los campos del JSON. Usa cadena vacia cuando falte informacion de texto y null cuando falten cantidades.",
          "No generes campos de precios ni valores monetarios.",
          "Ignora referencias al cliente y enfocate en la informacion del solicitante o proveedor.",
        ].join(" "),
      },
    ];

    if (contentType.startsWith("image/")) {
      const base64 = buffer.toString("base64");
      inputContent.push({
        type: "input_image",
        image_url: `data:${contentType};base64,${base64}`,
        detail: "high",
      });
    } else {
      const uploadedFile = await openai.files.create({
        file: await toFile(buffer, fileEntry.name, { type: contentType }),
        purpose: "assistants",
      });

      const processedFile = await openai.files.waitForProcessing(uploadedFile.id, {
        pollInterval: 1_000,
        maxWait: 60_000,
      });

      inputContent.push({
        type: "input_file",
        file_id: processedFile.id,
      });
    }

    const response = await openai.responses.create({
      model: DEFAULT_MODEL,
      temperature: 0.1,
      max_output_tokens: 2000,
      input: [
        {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Eres un asistente que convierte documentos en solicitudes de cotizacion (RFQ) estructuradas.",
                "Debes respetar exactamente el esquema JSON proporcionado.",
                "Utiliza los valores por defecto de la plantilla cuando falte informacion: packing=Export seaworthy, deliveryTerms=Your best, currency=EUR/USD, paymentTerms=To be agreed, guarantees=12/18 months, origin=TBA.",
                "Completa siempre la seccion supplier aunque sea con campos vacios, evita mencionar clientes y no generes campos de precios.",
              ].join(" "),
            },
          ],
        },
        {
          type: "message",
          role: "user",
          content: inputContent,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "quote_extraction",
          strict: true,
          schema: quoteExtractionJsonSchema,
        },
      },
    });

    if (!("output_text" in response) || !response.output_text) {
      throw new Error("La API no devolvio texto procesado");
    }

    const parsedPayload = extractParsedContent(response);
    const rawJson = parsedPayload ?? tryParseJson(response.output_text);
    const normalized = normalizeExtraction(rawJson);
    const enhanced = await enhanceItemDescriptions(normalized);

    return NextResponse.json({ data: enhanced });
  } catch (error) {
    console.error("process-quote:error", error);

    if (error && typeof error === "object" && "status" in error && "message" in error) {
      const apiError = error as { status?: number; message?: string; error?: unknown };
      const statusCode = typeof apiError.status === "number" ? apiError.status : 500;
      return NextResponse.json({ error: apiError.message ?? "OpenAI request failed" }, { status: statusCode });
    }

    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function enhanceItemDescriptions(quote: QuoteExtraction): Promise<QuoteExtraction> {
  if (!quote.items.length) {
    return quote;
  }

  const itemsToImprove = quote.items
    .map((item, index) => ({ index, description: item.description?.trim() ?? '' }))
    .filter((entry) => entry.description.length > 0);

  if (itemsToImprove.length === 0) {
    return quote;
  }

  try {
    const response = await openai.responses.create({
      model: DEFAULT_MODEL,
      temperature: 0.1,
      max_output_tokens: 1500,
      input: [
        {
          type: 'message',
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'Eres un asistente que reescribe descripciones tecnicas de items para una RFQ.',
                'Para cada item analiza el texto y devuelve los campos item, brandManufacturer, model, application, voltageFrequency y referencePartNumber.',
                'El campo item debe ser un nombre corto y claro del componente (por ejemplo "Compressor" o "Filter Cartridge").',
                'El campo brandManufacturer debe contener la marca o fabricante si aparece en el texto; de lo contrario usa "-".',
                'El campo model debe incluir todos los codigos de modelo o variantes relevantes. Usa "-" si no se indican.',
                'El campo application debe resumir en una frase muy breve el uso o contexto (por ejemplo "For twin-temp heat pump model YS-13020"); si no hay informacion, devuelve "-".',
                'El campo voltageFrequency debe reflejar valores electricos como "220V, 60Hz" cuando existan, o "-" si no aplica.',
                'El campo referencePartNumber debe incluir numeros de parte, referencias cruzadas u otros identificadores adicionales; si faltan, responde "-".',
                "Si algun dato no esta disponible, responde '-' sin inventar informacion.",
                'Devuelve siempre un JSON que siga exactamente el esquema proporcionado usando el mismo indice que el item de entrada.'
                'All fields must be written in English.'
              ].join(' ')
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({ items: itemsToImprove }, null, 2)
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'rfq_item_description_enrichment',
          strict: true,
          schema: {
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['index', 'fields'],
                  properties: {
                    index: { type: 'integer', minimum: 0 },
                    fields: {
                      type: 'object',
                      required: ['item', 'brandManufacturer', 'model', 'application', 'voltageFrequency', 'referencePartNumber'],
                      properties: {
                        item: { type: ['string', 'null'] },
                        brandManufacturer: { type: ['string', 'null'] },
                        model: { type: ['string', 'null'] },
                        application: { type: ['string', 'null'] },
                        voltageFrequency: { type: ['string', 'null'] },
                        referencePartNumber: { type: ['string', 'null'] }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const parsed = extractParsedContent(response) ?? tryParseJson(response.output_text);
    if (parsed && typeof parsed === 'object' && 'items' in parsed) {
      const enrichedItems = (parsed as { items?: Array<{ index: number; fields: Record<string, string | null | undefined> }> }).items ?? [];
      for (const entry of enrichedItems) {
        if (
          !entry ||
          typeof entry.index !== 'number' ||
          entry.index < 0 ||
          entry.index >= quote.items.length ||
          !entry.fields || typeof entry.fields !== 'object'
        ) {
          continue;
        }

        const fields = entry.fields as Record<string, string | null | undefined>;
        const format = (label: string, value: string | null | undefined) => `${label}: ${value && value.trim() ? value.trim() : '-'}`;
        const formatted = [
          format('Item', fields.item),
          format('Brand/Manufacturer', fields.brandManufacturer),
          format('Model', fields.model),
          format('Application', fields.application),
          format('Voltage/Frequency', fields.voltageFrequency),
          format('Reference Part No.', fields.referencePartNumber)
        ].join('\n');

        quote.items[entry.index].richDescription = formatted;
      }
    }
  } catch (error) {
    console.warn('process-quote:enhance_descriptions', error);
  }

  return quote;
}

function extractParsedContent(response: unknown): unknown | undefined {
  if (!response || typeof response !== "object") return undefined;

  if ("output_parsed" in response && (response as { output_parsed?: unknown }).output_parsed != null) {
    return (response as { output_parsed?: unknown }).output_parsed;
  }

  if ("output" in response && Array.isArray((response as { output?: unknown[] }).output)) {
    for (const item of (response as { output?: Array<Record<string, unknown>> }).output ?? []) {
      if (!item || typeof item !== "object") continue;
      const contents = (item as { content?: unknown }).content;
      if (!Array.isArray(contents)) continue;

      for (const block of contents as Array<Record<string, unknown>>) {
        if (!block || typeof block !== "object") continue;
        if ("parsed" in block && block.parsed != null) {
          return block.parsed;
        }
        if (typeof block.text === "string") {
          try {
            return JSON.parse(block.text);
          } catch (_error) {
            // ignore malformed block and continue
          }
        }
      }
    }
  }

  return undefined;
}

function tryParseJson(payload: string) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    const start = payload.indexOf("{");
    const end = payload.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("La respuesta del modelo no contiene JSON valido.");
    }

    const trimmed = payload.slice(start, end + 1);

    try {
      return JSON.parse(trimmed);
    } catch (nestedError) {
      const message = nestedError instanceof Error ? nestedError.message : String(nestedError);
      throw new Error(`El JSON devuelto por el modelo es invalido: ${message}`);
    }
  }
}


