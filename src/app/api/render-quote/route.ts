import { NextResponse, type NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import path from "path";
import { promises as fs } from "fs";
import { z } from "zod";
import { defaultBranding } from "@/config/branding";
import { computeTotals, normalizeExtraction } from "@/lib/quoteSchema";
import type { BrandingProfile, QuoteExtraction } from "@/types/quote";

export const runtime = "nodejs";

const brandOverrideSchema = z
  .object({
    companyName: z.string().optional(),
    addressLines: z.array(z.string()).optional(),
    contactLines: z.array(z.string()).optional(),
    logoRelativePath: z.string().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
  })
  .optional();

const requestSchema = z.object({
  quote: z.unknown(),
  brand: brandOverrideSchema,
  reviewer: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Solicitud invalida" }, { status: 400 });
    }

    const quote = normalizeExtraction(parsed.data.quote);
    const brand = { ...defaultBranding, ...(parsed.data.brand ?? {}) } as BrandingProfile;
    const reviewer = parsed.data.reviewer;

    const pdfBuffer = await buildPdf(quote, brand, reviewer);
    const trimmedQuote = quote.metadata.quoteNumber?.replace(/[^a-zA-Z0-9_-]/g, "") ?? Date.now().toString();
    const fileName = `cotizacion-${trimmedQuote}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("render-quote:error", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function buildPdf(quote: QuoteExtraction, brand: BrandingProfile, reviewer?: string | undefined) {
  return new Promise<Buffer>(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const buffers: Buffer[] = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      await drawHeader(doc, brand, quote);
      doc.moveDown(1.5);
      drawSummary(doc, quote);
      doc.moveDown(1);
      drawItemsTable(doc, quote);
      doc.moveDown(1);
      drawTotals(doc, quote);

      if (quote.remarks || quote.metadata.additionalNotes || reviewer) {
        doc.moveDown(1);
        drawNotes(doc, quote, reviewer);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function drawHeader(doc: PDFKit.PDFDocument, brand: BrandingProfile, quote: QuoteExtraction) {
  const headerY = doc.y;
  doc.fillColor(brand.primaryColor).fontSize(22).text(brand.companyName, { continued: false });

  const logoPath = path.join(process.cwd(), "public", brand.logoRelativePath);
  try {
    const logoBuffer = await fs.readFile(logoPath);
    doc.image(logoBuffer, doc.page.width - 160, headerY - 20, { fit: [110, 60], align: "right" });
  } catch (error) {
    console.warn("No logo available at", logoPath, error instanceof Error ? error.message : error);
  }

  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#4b5563");
  brand.addressLines.forEach((line) => doc.text(line));
  brand.contactLines.forEach((line) => doc.text(line));

  doc.moveDown(1);
  doc.fillColor(brand.accentColor).fontSize(16).text("Resumen de Cotizacion");
  doc.fillColor("#111827");

  const meta = quote.metadata;
  const details: Array<[string, string | undefined]> = [
    ["Numero", meta.quoteNumber],
    ["Fecha", meta.issueDate],
    ["Validez", meta.expirationDate],
    ["Moneda", meta.currency],
    ["Proyecto", meta.projectName],
    ["Terminos de pago", meta.paymentTerms],
    ["Terminos de entrega", meta.deliveryTerms],
  ];

  details.forEach(([label, value]) => {
    if (!value) return;
    doc.fontSize(10).text(`${label}: ${value}`);
  });
}

function drawSummary(doc: PDFKit.PDFDocument, quote: QuoteExtraction) {
  const supplier = quote.metadata.supplier ?? {};
  const customer = quote.metadata.customer ?? {};

  doc.fontSize(12).fillColor("#111827").text("Proveedor", { underline: true });
  drawPartyBlock(doc, supplier);

  doc.moveDown(0.75);
  doc.fontSize(12).fillColor("#111827").text("Cliente", { underline: true });
  drawPartyBlock(doc, customer);
}

function drawPartyBlock(doc: PDFKit.PDFDocument, party: Record<string, string | undefined>) {
  const lines: string[] = [];
  if (party.companyName) lines.push(party.companyName);
  if (party.name && party.name !== party.companyName) lines.push(party.name);
  if (party.address) lines.push(party.address);
  if (party.phone) lines.push(`Tel: ${party.phone}`);
  if (party.email) lines.push(`Email: ${party.email}`);
  if (party.taxId) lines.push(`Tax ID: ${party.taxId}`);

  doc.fontSize(10).fillColor("#374151");
  if (lines.length === 0) {
    doc.text("Sin datos proporcionados");
    return;
  }

  lines.forEach((line) => doc.text(line));
}

function drawItemsTable(doc: PDFKit.PDFDocument, quote: QuoteExtraction) {
  const tableTop = doc.y;
  const columnPositions = {
    index: 50,
    description: 90,
    quantity: 340,
    unitPrice: 390,
    total: 460,
  } as const;

  doc.fontSize(11).fillColor("#1f2937");
  doc.text("#", columnPositions.index, tableTop, { width: 30, align: "left" });
  doc.text("Descripcion", columnPositions.description, tableTop, { width: 230 });
  doc.text("Cantidad", columnPositions.quantity, tableTop, { width: 40, align: "right" });
  doc.text("Unitario", columnPositions.unitPrice, tableTop, { width: 60, align: "right" });
  doc.text("Total", columnPositions.total, tableTop, { width: 80, align: "right" });

  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e5e7eb").stroke();

  doc.fontSize(10).fillColor("#374151");
  quote.items.forEach((item, index) => {
    const rowY = doc.y + 8;
    doc.text(String(index + 1), columnPositions.index, rowY, { width: 30 });
    doc.text(item.description, columnPositions.description, rowY, { width: 230 });
    doc.text(formatNumber(item.quantity), columnPositions.quantity, rowY, { width: 40, align: "right" });
    doc.text(formatCurrency(item.unitPrice, quote.metadata.currency), columnPositions.unitPrice, rowY, {
      width: 60,
      align: "right",
    });
    doc.text(formatCurrency(item.totalPrice, quote.metadata.currency), columnPositions.total, rowY, {
      width: 80,
      align: "right",
    });
    doc.moveDown(0.8);
  });
}

function drawTotals(doc: PDFKit.PDFDocument, quote: QuoteExtraction) {
  const totals = computeTotals(quote.items, quote.totals);
  const currency = quote.metadata.currency;

  const rows: Array<[string, number | null]> = [
    ["Subtotal", totals.subtotal ?? null],
    ["Impuestos", totals.taxes ?? null],
    ["Envio", totals.shipping ?? null],
    ["Descuento", totals.discount != null ? totals.discount * -1 : null],
    ["Total", totals.total ?? totals.subtotal ?? null],
  ];

  const startX = 340;
  doc.fontSize(11).fillColor("#111827");

  rows.forEach(([label, value]) => {
    if (value == null) return;
    const y = doc.y + 6;
    doc.text(label, startX, y, { width: 120, align: "right" });
    doc.text(formatCurrency(value, currency), startX + 130, y, { width: 80, align: "right" });
    doc.moveDown(0.6);
  });
}

function drawNotes(doc: PDFKit.PDFDocument, quote: QuoteExtraction, reviewer?: string | undefined) {
  doc.fillColor("#111827").fontSize(12).text("Notas adicionales", { underline: true });
  doc.fontSize(10).fillColor("#374151");

  if (quote.remarks) {
    doc.text(quote.remarks);
    doc.moveDown(0.5);
  }

  if (quote.metadata.additionalNotes) {
    doc.text(quote.metadata.additionalNotes);
    doc.moveDown(0.5);
  }

  if (reviewer) {
    doc.text(`Revisado por: ${reviewer}`);
  }
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "";
  return Number(value).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function formatCurrency(value: number | null | undefined, currency?: string): string {
  if (value == null) return "";
  const unit = currency && currency.length <= 5 ? currency.toUpperCase() : "USD";
  try {
    return Number(value).toLocaleString("es-ES", {
      style: "currency",
      currency: unit,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch (_error) {
    return `${unit} ${Number(value).toFixed(2)}`;
  }
}
