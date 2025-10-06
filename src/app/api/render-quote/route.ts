import { NextResponse, type NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import path from "path";
import { promises as fs } from "fs";
import { z } from "zod";
import { defaultBranding } from "@/config/branding";
import { normalizeExtraction } from "@/lib/quoteSchema";
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

    const pdfBytes: Uint8Array = pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);
    const pdfBody = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;

    return new NextResponse(pdfBody, {
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
      drawSupplierSection(doc, quote);
      drawKeyDetails(doc, quote);
      drawItemsTable(doc, quote);
      drawSections(doc, quote, reviewer);

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

  const meta = quote.metadata;
  doc.moveDown(0.8);
  doc.fillColor(brand.accentColor).fontSize(16).text("Request for Quotation");
  doc.fillColor("#111827").fontSize(11);
  doc.text(`RFQ #: ${meta.rfqNumber ?? "-"}`);
  doc.text(`Date: ${meta.issueDate ?? "-"}`);
  doc.text(`Due date: ${meta.dueDate ?? "-"}`);
  if (meta.subject) {
    doc.text(`Subject: ${meta.subject}`);
  }
}

function drawSupplierSection(doc: PDFKit.PDFDocument, quote: QuoteExtraction) {
  const supplier = quote.metadata.supplier ?? {};
  const marginLeft = doc.page.margins?.left ?? 72;

  doc.moveDown(1);
  doc.x = marginLeft;
  doc.fontSize(12).fillColor("#111827").text("Supplier", { underline: true });

  const lines: string[] = [];
  if (supplier.companyName) lines.push(supplier.companyName);
  if (supplier.name) lines.push(supplier.name);
  if (supplier.address) lines.push(supplier.address);
  if (supplier.phone) lines.push(`Tel: ${supplier.phone}`);
  if (supplier.email) lines.push(`Email: ${supplier.email}`);
  if (supplier.website) lines.push(`Website: ${supplier.website}`);
  if (supplier.taxId) lines.push(`Tax ID: ${supplier.taxId}`);

  doc.fontSize(10).fillColor("#374151");
  if (lines.length === 0) {
    doc.text("No details provided");
  } else {
    lines.forEach((line) => doc.text(line));
  }
}

function drawKeyDetails(doc: PDFKit.PDFDocument, quote: QuoteExtraction) {
  const meta = quote.metadata;
  const entries: Array<[string, string | null | undefined]> = [
    ["Packing", meta.packing],
    ["Delivery terms", meta.deliveryTerms],
    ["Currency", meta.currency],
    ["Payment", meta.paymentTerms],
    ["Guarantees", meta.guarantees],
    ["Origin", meta.origin],
  ];

  const marginLeft = doc.page.margins?.left ?? 72;
  const marginRight = doc.page.margins?.right ?? 72;
  const availableWidth = doc.page.width - marginLeft - marginRight;
  const columnCount = 2;
  const gap = 18;
  const boxWidth = (availableWidth - gap) / columnCount;
  const labelColor = "#6b7280";
  const valueColor = "#1f2937";

  let cursorY = doc.y + 12;
  let index = 0;

  while (index < entries.length) {
    const rowEntries = entries.slice(index, index + columnCount);
    let rowHeight = 0;

    rowEntries.forEach(([label, value], column) => {
      const x = marginLeft + column * (boxWidth + gap);
      const valueText = value && value.trim() ? value : "-";
      const valueHeight = doc.heightOfString(valueText, { width: boxWidth - 16 });
      const boxHeight = Math.max(32, valueHeight + 20);
      rowHeight = Math.max(rowHeight, boxHeight);

      doc.lineWidth(0.5).strokeColor("#d1d5db").rect(x, cursorY, boxWidth, boxHeight).stroke();

      const previousX = doc.x;
      const previousY = doc.y;

      doc.fontSize(9).fillColor(labelColor).text(label.toUpperCase(), x + 8, cursorY + 6, { width: boxWidth - 16 });
      doc.fontSize(10).fillColor(valueColor).text(valueText, x + 8, cursorY + 18, {
        width: boxWidth - 16,
      });

      doc.x = previousX;
      doc.y = previousY;
    });

    cursorY += rowHeight + 12;
    index += columnCount;
  }

  doc.y = cursorY;
  doc.x = marginLeft;
  doc.moveDown(0.5);
  doc.fillColor("#111827");
}

function drawItemsTable(doc: PDFKit.PDFDocument, quote: QuoteExtraction) {
  const marginLeft = doc.page.margins?.left ?? 72;
  const marginRight = doc.page.margins?.right ?? 72;
  const tableWidth = doc.page.width - marginLeft - marginRight;

  const indexWidth = 40;
  const quantityWidth = 70;
  const notesWidth = Math.max(160, Math.min(220, tableWidth * 0.35));
  const descriptionWidth = tableWidth - indexWidth - quantityWidth - notesWidth;

  doc.moveDown(1);
  let cursorY = doc.y;

  const drawHeaderRow = () => {
    doc.lineWidth(0.5).fillColor("#e2e8f0").rect(marginLeft, cursorY, tableWidth, 22).fill();
    doc.strokeColor("#cbd5f5").rect(marginLeft, cursorY, tableWidth, 22).stroke();

    doc.fontSize(10).fillColor("#1f2937");
    doc.text("#", marginLeft + 8, cursorY + 6, { width: indexWidth - 16 });
    doc.text("Description", marginLeft + indexWidth + 8, cursorY + 6, {
      width: descriptionWidth - 16,
    });
    doc.text("Quantity", marginLeft + indexWidth + descriptionWidth + 8, cursorY + 6, {
      width: quantityWidth - 16,
      align: "right",
    });
    doc.text("Notes", marginLeft + indexWidth + descriptionWidth + quantityWidth + 8, cursorY + 6, {
      width: notesWidth - 16,
    });

    cursorY += 22;
    doc
      .moveTo(marginLeft, cursorY)
      .lineTo(marginLeft + tableWidth, cursorY)
      .strokeColor("#d1d5db")
      .stroke();
  };

  const ensureRowFits = (rowHeight: number) => {
    const bottomMargin = doc.page.margins?.bottom ?? 72;
    const availableBottom = doc.page.height - bottomMargin;
    if (cursorY + rowHeight > availableBottom) {
      doc.addPage();
      doc.moveDown(1);
      cursorY = doc.y;
      drawHeaderRow();
    }
  };

  drawHeaderRow();

  quote.items.forEach((item, index) => {
    const rowNumber = String(item.itemNumber ?? index + 1);
    const description = item.richDescription ?? item.description ?? "";
    const quantity = formatNumber(item.quantity) || "-";
    const notes = item.notes ?? "";

    const descriptionHeight = doc.heightOfString(description, { width: descriptionWidth - 16 });
    const notesHeight = doc.heightOfString(notes, { width: notesWidth - 16 });
    const quantityHeight = doc.heightOfString(quantity, { width: quantityWidth - 16 });
    const rowHeight = Math.max(24, descriptionHeight + 12, notesHeight + 12, quantityHeight + 12);

    ensureRowFits(rowHeight);

    const rowTop = cursorY + 4;
    const previousX = doc.x;
    const previousY = doc.y;

    doc.fontSize(10).fillColor("#1f2937");
    doc.text(rowNumber, marginLeft + 8, rowTop, { width: indexWidth - 16 });
    doc.text(description, marginLeft + indexWidth + 8, rowTop, { width: descriptionWidth - 16 });
    doc.text(quantity, marginLeft + indexWidth + descriptionWidth + 8, rowTop, {
      width: quantityWidth - 16,
      align: "right",
    });
    doc.text(notes, marginLeft + indexWidth + descriptionWidth + quantityWidth + 8, rowTop, {
      width: notesWidth - 16,
    });

    doc.x = previousX;
    doc.y = previousY;

    cursorY += rowHeight;
    doc
      .moveTo(marginLeft, cursorY)
      .lineTo(marginLeft + tableWidth, cursorY)
      .strokeColor("#e5e7eb")
      .stroke();
  });

  doc.y = cursorY + 6;
  doc.x = marginLeft;
}

function drawSections(doc: PDFKit.PDFDocument, quote: QuoteExtraction, reviewer?: string | undefined) {
  const marginLeft = doc.page.margins?.left ?? 72;
  const marginRight = doc.page.margins?.right ?? 72;
  const usableWidth = doc.page.width - marginLeft - marginRight;

  const sections: Array<[string, string | null | undefined]> = [
    ["Packing requirements", quote.metadata.packingRequirements],
    ["Accessories / Inclusions", quote.metadata.accessoriesInclusions],
    ["Additional notes", quote.remarks],
  ];

  sections.forEach(([title, value]) => {
    if (!value) return;
    doc.moveDown(0.8);
    doc.x = marginLeft;
    doc.fillColor("#111827").fontSize(12).text(title, { underline: true, width: usableWidth });
    doc.fontSize(10).fillColor("#374151").text(value, { width: usableWidth });
  });

  if (reviewer) {
    doc.moveDown(0.6);
    doc.x = marginLeft;
    doc.fontSize(10).fillColor("#374151").text(`Reviewed by: ${reviewer}`, { width: usableWidth });
  }

  doc.fillColor("#111827");
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "";
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

