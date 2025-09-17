import { z } from "zod";
import type { QuoteExtraction, QuoteItem, QuoteTotals } from "@/types/quote";

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const contactSchema = z
  .object({
    name: optionalString,
    companyName: optionalString,
    address: optionalString,
    phone: optionalString,
    email: optionalString,
    taxId: optionalString,
  })
  .partial();

const numberLike = z
  .union([z.number(), z.null(), z.undefined(), z.string()])
  .transform((value) => normalizeNumber(value));

export const quoteItemSchema = z
  .object({
    itemNumber: z.union([z.string(), z.null(), z.undefined()]).optional(),
    description: z.string().min(1, "La descripcion del item es obligatoria"),
    quantity: numberLike.optional(),
    unitPrice: numberLike.optional(),
    totalPrice: numberLike.optional(),
    notes: optionalString,
  })
  .transform((value) => ({
    ...value,
    quantity: value.quantity ?? null,
    unitPrice: value.unitPrice ?? null,
    totalPrice: value.totalPrice ?? null,
  }));

export const quoteTotalsSchema = z
  .object({
    subtotal: numberLike.optional(),
    taxes: numberLike.optional(),
    shipping: numberLike.optional(),
    discount: numberLike.optional(),
    total: numberLike.optional(),
  })
  .transform((totals) => normaliseTotals(totals));

export const quoteExtractionSchema = z
  .object({
    fullText: z.string().min(1),
    metadata: z
      .object({
        supplier: contactSchema.optional(),
        customer: contactSchema.optional(),
        quoteNumber: optionalString,
        issueDate: optionalString,
        expirationDate: optionalString,
        currency: optionalString,
        paymentTerms: optionalString,
        deliveryTerms: optionalString,
        projectName: optionalString,
        additionalNotes: optionalString,
      })
      .default({}),
    items: z.array(quoteItemSchema).min(1, "Debes incluir al menos un item"),
    totals: quoteTotalsSchema.default({}),
    remarks: optionalString,
  })
  .transform((value) => ({
    ...value,
    totals: value.totals ?? {},
  }));

export const quoteExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["fullText", "items", "metadata", "totals"],
  properties: {
    fullText: { type: "string", description: "Texto completo de la cotizacion" },
    metadata: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        supplier: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            companyName: { type: "string" },
            address: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
            taxId: { type: "string" },
          },
        },
        customer: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            companyName: { type: "string" },
            address: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
            taxId: { type: "string" },
          },
        },
        quoteNumber: { type: "string" },
        issueDate: { type: "string" },
        expirationDate: { type: "string" },
        currency: { type: "string" },
        paymentTerms: { type: "string" },
        deliveryTerms: { type: "string" },
        projectName: { type: "string" },
        additionalNotes: { type: "string" },
      },
    },
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description"],
        properties: {
          itemNumber: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: "number" },
          totalPrice: { type: "number" },
          notes: { type: "string" },
        },
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      properties: {
        subtotal: { type: "number" },
        taxes: { type: "number" },
        shipping: { type: "number" },
        discount: { type: "number" },
        total: { type: "number" },
      },
    },
    remarks: { type: "string" },
  },
};

export function normalizeExtraction(raw: unknown): QuoteExtraction {
  const parsed = quoteExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(" | "));
  }

  return {
    fullText: parsed.data.fullText,
    metadata: parsed.data.metadata ?? {},
    items: parsed.data.items.map(fillMissingTotals),
    totals: parsed.data.totals ?? {},
    remarks: parsed.data.remarks,
  };
}

function fillMissingTotals(item: QuoteItem): QuoteItem {
  const cleanItem: QuoteItem = {
    ...item,
    itemNumber: item.itemNumber ?? undefined,
    notes: item.notes,
  };

  if (cleanItem.totalPrice == null && cleanItem.quantity != null && cleanItem.unitPrice != null) {
    cleanItem.totalPrice = Number((cleanItem.quantity * cleanItem.unitPrice).toFixed(2));
  }

  return cleanItem;
}

function normaliseTotals(totals: QuoteTotals): QuoteTotals {
  const cleanTotals: QuoteTotals = {};
  const keys: Array<keyof QuoteTotals> = ["subtotal", "taxes", "shipping", "discount", "total"];

  for (const key of keys) {
    const value = totals[key];
    const normalised = normalizeNumber(value);
    if (normalised != null && !Number.isNaN(normalised)) {
      cleanTotals[key] = Number(normalised.toFixed(2));
    }
  }

  return cleanTotals;
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

export function computeTotals(items: QuoteItem[], currentTotals: QuoteTotals): QuoteTotals {
  const subtotal = items.reduce((sum, item) => {
    const amount = item.totalPrice ?? (item.quantity != null && item.unitPrice != null ? item.quantity * item.unitPrice : 0);
    return sum + (amount ?? 0);
  }, 0);

  const taxes = currentTotals.taxes ?? null;
  const shipping = currentTotals.shipping ?? null;
  const discount = currentTotals.discount ?? null;

  let total = currentTotals.total ?? null;
  if (total == null) {
    total = subtotal + (taxes ?? 0) + (shipping ?? 0) - (discount ?? 0);
  }

  return {
    subtotal: Number(subtotal.toFixed(2)),
    taxes,
    shipping,
    discount,
    total: total != null ? Number(total.toFixed(2)) : Number((subtotal + (taxes ?? 0) + (shipping ?? 0) - (discount ?? 0)).toFixed(2)),
  };
}
