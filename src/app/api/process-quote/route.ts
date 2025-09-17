import { NextResponse, type NextRequest } from "next/server";
import OpenAI from "openai";
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
    const base64 = buffer.toString("base64");

    const inputContent: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: [
          "Analiza la cotizacion adjunta y extrae la informacion clave.",
          "Completa todos los campos del JSON. Usa cadenas vacias cuando falte informacion.",
          "Los montos numericos deben ir como numero decimal sin simbolos.",
          "Si detectas impuestos o descuentos separalos en la seccion totals.",
        ].join(" "),
      },
    ];

    if (contentType.startsWith("image/")) {
      inputContent.push({
        type: "input_image",
        image_url: `data:${contentType};base64,${base64}`,
        detail: "high",
      });
    } else {
      inputContent.push({
        type: "input_file",
        file_data: base64,
        filename: fileEntry.name,
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
                "Eres un asistente que convierte cotizaciones en datos estructurados.",
                "Debes respetar exactamente el esquema JSON proporcionado.",
                "Usa numeros decimales con punto como separador y sin simbolos.",
                "Completa siempre supplier y customer aunque sea con campos vacios.",
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

    const rawJson = tryParseJson(response.output_text);
    const normalized = normalizeExtraction(rawJson);

    return NextResponse.json({ data: normalized });
  } catch (error) {
    console.error("process-quote:error", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function tryParseJson(payload: string) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    const trimmed = payload.slice(payload.indexOf("{"), payload.lastIndexOf("}") + 1);
    return JSON.parse(trimmed);
  }
}
