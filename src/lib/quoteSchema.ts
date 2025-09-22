import { z } from "zod";
import type { QuoteExtraction, QuoteItem, QuoteMetadata } from "@/types/quote";

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

const supplierSchema = z
  .object({
    name: optionalString,
    companyName: optionalString,
    address: optionalString,
    phone: optionalString,
    email: optionalString,
    website: optionalString,
    taxId: optionalString,
  })
  .partial();

const numberLike = z
  .union([z.number(), z.null(), z.undefined(), z.string()])
  .transform((value) => normalizeNumber(value));

export const quoteItemSchema = z
  .object({
    itemNumber: optionalString,
    description: z.string().min(1, "La descripcion del item es obligatoria"),
    quantity: numberLike.optional(),
    unit: optionalString,
    notes: optionalString,
    richDescription: optionalString,
  })
  .transform((value) => ({
    ...value,
    quantity: value.quantity ?? null,
  }));

const metadataDefaults = {
  packing: "Export seaworthy",
  deliveryTerms: "Your best",
  currency: "EUR/USD",
  paymentTerms: "To be agreed",
  guarantees: "12/18 months",
  origin: "TBA",
} as const;

export const quoteExtractionSchema = z
  .object({
    fullText: z.string().min(1),
    metadata: z
      .object({
        supplier: supplierSchema.optional(),
        rfqNumber: optionalString,
        issueDate: optionalString,
        dueDate: optionalString,
        subject: optionalString,
        packing: optionalString,
        deliveryTerms: optionalString,
        currency: optionalString,
        paymentTerms: optionalString,
        guarantees: optionalString,
        origin: optionalString,
        packingRequirements: optionalString,
        accessoriesInclusions: optionalString,
      })
      .default({}),
    items: z.array(quoteItemSchema).min(1, "Debes incluir al menos un item"),
    remarks: optionalString,
  })
  .transform((value) => ({
    ...value,
    metadata: applyMetadataDefaults(value.metadata ?? {}),
  }));

export const quoteExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["fullText", "items", "metadata", "remarks"],
  properties: {
    fullText: { type: "string", description: "Texto completo del documento" },
    metadata: {
      type: "object",
      additionalProperties: false,
      required: [
        "supplier",
        "rfqNumber",
        "issueDate",
        "dueDate",
        "subject",
        "packing",
        "deliveryTerms",
        "currency",
        "paymentTerms",
        "guarantees",
        "origin",
        "packingRequirements",
        "accessoriesInclusions",
      ],
      properties: {
        supplier: {
          type: "object",
          additionalProperties: false,
          required: ["name", "companyName", "address", "phone", "email", "website", "taxId"],
          properties: {
            name: { type: ["string", "null"] },
            companyName: { type: ["string", "null"] },
            address: { type: ["string", "null"] },
            phone: { type: ["string", "null"] },
            email: { type: ["string", "null"] },
            website: { type: ["string", "null"] },
            taxId: { type: ["string", "null"] },
          },
        },
        rfqNumber: { type: ["string", "null"] },
        issueDate: { type: ["string", "null"] },
        dueDate: { type: ["string", "null"] },
        subject: { type: ["string", "null"] },
        packing: { type: ["string", "null"] },
        deliveryTerms: { type: ["string", "null"] },
        currency: { type: ["string", "null"] },
        paymentTerms: { type: ["string", "null"] },
        guarantees: { type: ["string", "null"] },
        origin: { type: ["string", "null"] },
        packingRequirements: { type: ["string", "null"] },
        accessoriesInclusions: { type: ["string", "null"] },
      },
    },
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["itemNumber", "description", "quantity", "unit", "notes", "richDescription"],
        properties: {
          itemNumber: { type: ["string", "null"] },
          description: { type: "string" },
          quantity: { type: ["number", "null", "string"] },
          unit: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
          richDescription: { type: ["string", "null"] },
        },
      },
    },
    remarks: { type: ["string", "null"] },
  },
};

export function normalizeExtraction(raw: unknown): QuoteExtraction {
  const parsed = quoteExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(" | "));
  }

  const metadata = applyMetadataDefaults(parsed.data.metadata ?? {});

  return {
    fullText: parsed.data.fullText,
    metadata,
    items: parsed.data.items,
    remarks: parsed.data.remarks,
  };
}

function applyMetadataDefaults(metadata: QuoteMetadata): QuoteMetadata {
  return {
    ...metadataDefaults,
    ...metadata,
    supplier: metadata.supplier,
    packing: metadata.packing ?? metadataDefaults.packing,
    deliveryTerms: metadata.deliveryTerms ?? metadataDefaults.deliveryTerms,
    currency: metadata.currency ?? metadataDefaults.currency,
    paymentTerms: metadata.paymentTerms ?? metadataDefaults.paymentTerms,
    guarantees: metadata.guarantees ?? metadataDefaults.guarantees,
    origin: metadata.origin ?? metadataDefaults.origin,
  };
}

export function normalizeNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised = cleaned;

  if (lastComma > -1 && lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, "").replace(/,/g, ".");
  } else {
    normalised = cleaned.replace(/,/g, "");
  }

  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}
