import { describe, expect, it } from "vitest";
import { normalizeExtraction, normalizeNumber } from "@/lib/quoteSchema";

describe("normalizeNumber", () => {
  it("returns numbers unchanged when already numeric", () => {
    expect(normalizeNumber(12.5)).toBe(12.5);
    expect(normalizeNumber(-3)).toBe(-3);
  });

  it("parses localized numeric strings", () => {
    expect(normalizeNumber("1.234")).toBeCloseTo(1.234);
    expect(normalizeNumber("1.234,56")).toBeCloseTo(1234.56);
    expect(normalizeNumber("2,500.75")).toBeCloseTo(2500.75);
  });

  it("strips non digit characters and handles invalid inputs", () => {
    expect(normalizeNumber("$1,299.95")).toBeCloseTo(1299.95);
    expect(normalizeNumber("abc")).toBeNull();
    expect(normalizeNumber(undefined)).toBeNull();
    expect(normalizeNumber(null)).toBeNull();
  });
});

describe("normalizeExtraction", () => {
  const baseQuote = {
    fullText: "Example document contents",
    metadata: {
      supplier: {
        companyName: "ACME Corp",
        email: "   ",
      },
      rfqNumber: " RFQ-77 ",
      packing: "",
    },
    items: [
      {
        description: "Widget",
        quantity: "1,250.50",
        notes: "   ",
      },
    ],
    remarks: "",
  };

  it("applies defaults and normalizes optional fields", () => {
    const normalized = normalizeExtraction(baseQuote);

    expect(normalized.metadata.packing).toBe("Export seaworthy");
    expect(normalized.metadata.deliveryTerms).toBe("Your best");
    expect(normalized.metadata.currency).toBe("EUR/USD");
    expect(normalized.metadata.paymentTerms).toBe("To be agreed");
    expect(normalized.metadata.guarantees).toBe("12/18 months");
    expect(normalized.metadata.origin).toBe("TBA");
    expect(normalized.metadata.rfqNumber).toBe("RFQ-77");

    expect(normalized.metadata.supplier?.companyName).toBe("ACME Corp");
    expect(normalized.metadata.supplier?.email).toBeUndefined();

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0].quantity).toBeCloseTo(1250.5);
    expect(normalized.items[0].notes).toBeUndefined();

    expect(normalized.remarks).toBeUndefined();
  });

  it("throws descriptive error when required data is missing", () => {
    expect(() =>
      normalizeExtraction({
        fullText: "",
        metadata: {},
        items: [],
      })
    ).toThrow(/La descripcion del item es obligatoria|Debes incluir al menos un item/i);
  });
});
