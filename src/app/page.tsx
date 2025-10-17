"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import Image from "next/image";
import { defaultBranding } from "@/config/branding";
import { companyProfiles, defaultCompanyProfile } from "@/config/companyProfiles";
import type { BrandingProfile, QuoteExtraction, QuoteItem } from "@/types/quote";

interface UploadState {
  isDragging: boolean;
}

const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/tiff"];

export default function Home() {
  const [quote, setQuote] = useState<QuoteExtraction | null>(null);
  const [brand, setBrand] = useState<BrandingProfile>(defaultBranding);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(defaultCompanyProfile.id);
  const [reviewer, setReviewer] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>({ isDragging: false });
  const [isProcessing, setProcessing] = useState(false);
  const [isDownloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [isChatOpen, setChatOpen] = useState(false);

  const selectedCompany = useMemo(() => {
    return companyProfiles.find((profile) => profile.id === selectedCompanyId) ?? defaultCompanyProfile;
  }, [selectedCompanyId]);

  useEffect(() => {
    setBrand(selectedCompany.branding);
  }, [selectedCompany]);

  const handleFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Unsupported format. Use PDF or images (png, jpg, webp, tiff).");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setError(null);
    setProcessing(true);

    try {
      const response = await fetch("/api/process-quote", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(payload.error ?? "Failed to process the document");
      }

      const payload = (await response.json()) as { data: QuoteExtraction };
      setQuote(payload.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected failure";
      setError(message);
    } finally {
      setProcessing(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setUploadState({ isDragging: false });
      const file = event.dataTransfer.files?.[0];
      void handleFile(file ?? null);
    },
    [handleFile]
  );

  const onSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    void handleFile(file);
  };

  const handleMetadataChange = (key: keyof QuoteExtraction["metadata"], value: string) => {
    if (!quote) return;
    setQuote({
      ...quote,
      metadata: {
        ...quote.metadata,
        [key]: value.length ? value : undefined,
      },
    });
  };

  const handleSupplierChange = (
    field: keyof NonNullable<QuoteExtraction["metadata"]["supplier"]>,
    value: string
  ) => {
    if (!quote) return;
    const current = quote.metadata.supplier ?? {};
    setQuote({
      ...quote,
      metadata: {
        ...quote.metadata,
        supplier: {
          ...current,
          [field]: value.length ? value : undefined,
        },
      },
    });
  };

  const handleItemChange = (index: number, field: keyof QuoteItem, value: string) => {
    if (!quote) return;

    const updatedItems = quote.items.map((item, idx) => {
      if (idx !== index) return item;

      if (field === "description" || field === "itemNumber" || field === "notes" || field === "unit") {
        const trimmed = value.trim();
        return { ...item, [field]: trimmed.length ? trimmed : undefined };
      }

      if (field === "richDescription") {
        return { ...item, richDescription: value.length ? value : undefined };
      }

      if (field === "quantity") {
        return { ...item, quantity: parseNumberInput(value) };
      }

      return item;
    });

    setQuote({
      ...quote,
      items: updatedItems,
    });
  };

  const addItem = () => {
    if (!quote) return;
    setQuote({
      ...quote,
      items: [
        ...quote.items,
        {
          itemNumber: String(quote.items.length + 1),
          description: "",
          quantity: null,
          unit: "",
          notes: "",
          richDescription: "",
        },
      ],
    });
  };

  const removeItem = (index: number) => {
    if (!quote) return;
    setQuote({
      ...quote,
      items: quote.items.filter((_, idx) => idx !== index),
    });
  };

  const handleBrandLineChange = (field: keyof BrandingProfile, value: string) => {
    setBrand((current) => {
      if (field === "addressLines" || field === "contactLines") {
        return { ...current, [field]: splitLines(value) };
      }

      return { ...current, [field]: value } as BrandingProfile;
    });
  };

  const handleDownload = async () => {
    if (!quote) return;
    setDownloading(true);
    setError(null);

    try {
      const preparedQuote = prepareQuoteForDocument(quote);
      const response = await fetch("/api/render-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: preparedQuote, brand, reviewer }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "No se pudo generar el PDF" }));
        throw new Error(payload.error ?? "No se pudo generar el PDF");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const sanitizedRfq = (quote.metadata.rfqNumber ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
      const filename = sanitizedRfq ? `rfq-${sanitizedRfq}.pdf` : "rfq.pdf";
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo descargar";
      setError(message);
    } finally {
      setDownloading(false);
    }
  };

  const dropzoneClasses = `flex h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition ${uploadState.isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-400"}`;
  const toggleChat = useCallback(() => {
    setChatOpen((open) => !open);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold text-slate-900">Generate RFQ Documents</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Upload a PDF or image that contains the technical details of your request. The assistant extracts the data,
            maps everything to the RFQ structure, and lets you review it before creating the final document.
          </p>
        </header>

        <section>
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setUploadState({ isDragging: true });
            }}
            onDragLeave={() => setUploadState({ isDragging: false })}
            onDrop={onDrop}
            className={dropzoneClasses}
          >
            <input type="file" accept={ACCEPTED_TYPES.join(",")} className="hidden" onChange={onSelect} />
            <span className="text-base font-medium text-slate-900">
              {isProcessing ? "Processing document..." : "Drag your file here or click to browse"}
            </span>
            <span className="mt-2 text-xs text-slate-500">Supported formats: PDF, PNG, JPG, WEBP, TIFF (max 15 MB).</span>
          </label>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
        {quote ? (
          <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)]">
            <div className="space-y-6">
              <Card title="RFQ Details">
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField label="RFQ number" value={quote.metadata.rfqNumber ?? ""} onChange={(value) => handleMetadataChange("rfqNumber", value)} />
                  <TextField label="Issue date" value={quote.metadata.issueDate ?? ""} onChange={(value) => handleMetadataChange("issueDate", value)} placeholder="2025-09-17" />
                  <TextField label="Issue date limite" value={quote.metadata.dueDate ?? ""} onChange={(value) => handleMetadataChange("dueDate", value)} placeholder="2025-10-01" />
                  <TextField label="Subject" value={quote.metadata.subject ?? ""} onChange={(value) => handleMetadataChange("subject", value)} placeholder="Request for..." />
                </div>
              </Card>

              <Card title="Supplier">
                <PartyForm data={quote.metadata.supplier} onChange={handleSupplierChange} />
              </Card>

              <Card title="Key Conditions">
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField label="Packing" value={quote.metadata.packing ?? ""} onChange={(value) => handleMetadataChange("packing", value)} />
                  <TextField label="Delivery terms" value={quote.metadata.deliveryTerms ?? ""} onChange={(value) => handleMetadataChange("deliveryTerms", value)} />
                  <TextField label="Currency" value={quote.metadata.currency ?? ""} onChange={(value) => handleMetadataChange("currency", value)} />
                  <TextField label="Payment" value={quote.metadata.paymentTerms ?? ""} onChange={(value) => handleMetadataChange("paymentTerms", value)} />
                  <TextField label="Guarantees" value={quote.metadata.guarantees ?? ""} onChange={(value) => handleMetadataChange("guarantees", value)} />
                  <TextField label="Origin" value={quote.metadata.origin ?? ""} onChange={(value) => handleMetadataChange("origin", value)} />
                </div>
                <div className="mt-4 grid gap-4">
                  <TextAreaField
                    label="Packing requirements"
                    value={quote.metadata.packingRequirements ?? ""}
                    onChange={(value) => handleMetadataChange("packingRequirements", value)}
                    placeholder="Provide packing requirements, materials, etc."
                  />
                  <TextAreaField
                    label="Accessories / Inclusions"
                    value={quote.metadata.accessoriesInclusions ?? ""}
                    onChange={(value) => handleMetadataChange("accessoriesInclusions", value)}
                    placeholder="Brands, packing list with HS code, required certificates, etc."
                  />
                </div>
              </Card>

              <Card
                title="Requested Items"
                action={
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    onClick={addItem}
                  >
                    Add item
                  </button>
                }
              >
                <div className="space-y-6">
                  {quote.items.map((item, index) => (
                    <div key={`item-${index}`} className="rounded-md border border-slate-200 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-700">Item {index + 1}</p>
                        <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => removeItem(index)}>
                          Remove
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField label="Reference" value={item.itemNumber ?? ""} onChange={(value) => handleItemChange(index, "itemNumber", value)} />
                        <NumberField label="Quantity" value={item.quantity ?? null} onChange={(value) => handleItemChange(index, "quantity", value)} />
                        <TextField label="Unit" value={item.unit ?? ""} onChange={(value) => handleItemChange(index, "unit", value)} placeholder="e.g., EA" />
                      </div>
                      <TextAreaField
                        label="Description"
                        value={item.description ?? ""}
                        onChange={(value) => handleItemChange(index, "description", value)}
                        placeholder="Describe the material or service requested."
                      />
                      <TextAreaField
                        label="Formatted Description"
                        value={item.richDescription ?? ""}
                        onChange={(value) => handleItemChange(index, "richDescription", value)}
                        placeholder="Automatically generated by the assistant. You can edit it if needed."
                        highlight
                        helperText="This formatted content is what appears in the RFQ."
                      />
                      <TextAreaField
                        label="Notes"
                        value={item.notes ?? ""}
                        onChange={(value) => handleItemChange(index, "notes", value)}
                        placeholder="Conditions, drawing references, etc."
                      />
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Additional Notes">
                <TextAreaField
                  label="Notes for Supplier"
                  value={quote.remarks ?? ""}
                  onChange={(value) => setQuote({ ...quote, remarks: value.length ? value : undefined })}
                  placeholder="Additional instructions for the supplier"
                />
              </Card>

              <Card title="Branding & Reviewer">
                <SelectField
                  label="Issuing company"
                  value={selectedCompanyId}
                  onChange={setSelectedCompanyId}
                  options={companyProfiles.map((profile) => ({ value: profile.id, label: profile.label }))}
                />
                <p className="text-xs text-slate-500">Switching the issuing company updates supplier details and branding defaults automatically.</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField label="Company name" value={brand.companyName} onChange={(value) => handleBrandLineChange("companyName", value)} />
                  <TextField label="Primary color" value={brand.primaryColor} onChange={(value) => handleBrandLineChange("primaryColor", value)} />
                  <TextField label="Accent color" value={brand.accentColor} onChange={(value) => handleBrandLineChange("accentColor", value)} />
                  <TextField label="Logo path" value={brand.logoRelativePath} onChange={(value) => handleBrandLineChange("logoRelativePath", value)} />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <TextAreaField label="Address" value={brand.addressLines.join("\n")} onChange={(value) => handleBrandLineChange("addressLines", value)} />
                  <TextAreaField label="Contact" value={brand.contactLines.join("\n")} onChange={(value) => handleBrandLineChange("contactLines", value)} />
                </div>
                <div className="mt-4">
                  <TextField label="Reviewed by" value={reviewer} onChange={setReviewer} />
                </div>
              </Card>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDownloading ? "Generating PDF..." : "Download RFQ"}
                </button>
                <ToggleWithLabel label="Show JSON" checked={showRaw} onChange={setShowRaw} />
              </div>

              {showRaw ? (
                <pre className="max-h-96 overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
                  {JSON.stringify(quote, null, 2)}
                </pre>
              ) : null}
            </div>

            <Card title="Preview">
              <PreviewDocument quote={quote} brand={brand} reviewer={reviewer} />
            </Card>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={toggleChat}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
        aria-label={isChatOpen ? "Hide chatbot" : "Open chatbot"}
        aria-expanded={isChatOpen}
        aria-haspopup="dialog"
      >
        {isChatOpen ? "Hide Chat" : "Open Chatbot"}
      </button>

      {isChatOpen ? (
        <aside
          className="fixed bottom-24 right-6 z-50 flex h-[560px] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          role="dialog"
          aria-label="Database chatbot"
        >
          <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
            <span>Database Chatbot</span>
            <button
              type="button"
              onClick={closeChat}
              className="rounded-md px-2 py-1 text-xs font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:ring-offset-2"
              aria-label="Close chatbot"
            >
              Close
            </button>
          </div>
          <div className="flex-1">
            <iframe
              title="Database Chatbot"
              src="https://databasechatbot.vercel.app/"
              loading="lazy"
              className="h-full w-full"
              allow="clipboard-write; microphone; camera"
            />
          </div>
        </aside>
      ) : null}
    </main>
  );
}

function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {title ? (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {action ?? null}
        </div>
      ) : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col text-xs font-medium text-slate-600">
      <span className="mb-1 uppercase tracking-wide">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-100"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; }) {
  return (
    <label className="flex flex-col text-xs font-medium text-slate-600">
      <span className="mb-1 uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder, highlight = false, helperText }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; highlight?: boolean; helperText?: string }) {
  const containerClass = highlight
    ? "flex flex-col rounded-md border border-blue-200 bg-blue-50 p-3 text-xs font-medium text-slate-600 shadow-inner"
    : "flex flex-col text-xs font-medium text-slate-600";
  const labelClass = highlight
    ? "mb-2 uppercase tracking-wide text-blue-900"
    : "mb-1 uppercase tracking-wide";
  const textareaClass = highlight
    ? "rounded-md border border-blue-200 bg-white/80 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-100"
    : "rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-100";

  return (
    <label className={containerClass}>
      <span className={labelClass}>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className={textareaClass}
      />
      {helperText ? <span className="mt-2 text-[11px] font-normal text-blue-800">{helperText}</span> : null}
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col text-xs font-medium text-slate-600">
      <span className="mb-1 uppercase tracking-wide">{label}</span>
      <input
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-100"
      />
    </label>
  );
}

function ToggleWithLabel({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  );
}

function PartyForm({
  data,
  onChange,
}: {
  data?: QuoteExtraction["metadata"]["supplier"];
  onChange: (field: keyof NonNullable<QuoteExtraction["metadata"]["supplier"]>, value: string) => void;
}) {
  const supplier = data ?? {};

  return (
    <div className="space-y-3 text-sm">
      <TextField label="Company" value={supplier.companyName ?? ""} onChange={(value) => onChange("companyName", value)} />
      <TextField label="Contact" value={supplier.name ?? ""} onChange={(value) => onChange("name", value)} />
      <TextAreaField label="Address" value={supplier.address ?? ""} onChange={(value) => onChange("address", value)} />
      <TextField label="Phone" value={supplier.phone ?? ""} onChange={(value) => onChange("phone", value)} />
      <TextField label="Email" value={supplier.email ?? ""} onChange={(value) => onChange("email", value)} />
      <TextField label="Website" value={supplier.website ?? ""} onChange={(value) => onChange("website", value)} />
      <TextField label="Tax ID" value={supplier.taxId ?? ""} onChange={(value) => onChange("taxId", value)} />
    </div>
  );
}

function PreviewDocument({ quote, brand, reviewer }: { quote: QuoteExtraction; brand: BrandingProfile; reviewer: string }) {
  const { metadata } = quote;
  const summaryEntries: Array<[string, string | null | undefined]> = [
    ["Packing", metadata.packing],
    ["Delivery terms", metadata.deliveryTerms],
    ["Currency", metadata.currency],
    ["Payment", metadata.paymentTerms],
    ["Guarantees", metadata.guarantees],
    ["Origin", metadata.origin],
  ];

  return (
    <div className="space-y-5 text-sm text-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-start gap-4">
          {brand.logoRelativePath ? (
            <Image
              src={`/${brand.logoRelativePath}`}
              alt={`${brand.companyName} logo`}
              width={128}
              height={80}
              className="h-16 w-auto object-contain"
              priority
            />
          ) : null}
          <div>
            <p className="text-lg font-semibold text-slate-900">{brand.companyName}</p>
            <div className="mt-1 text-xs text-slate-500">
              {brand.addressLines.map((line, idx) => (
                <p key={`address-${idx}`}>{line}</p>
              ))}
              {brand.contactLines.map((line, idx) => (
                <p key={`contact-${idx}`}>{line}</p>
              ))}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>RFQ #: {metadata.rfqNumber ?? "-"}</p>
          <p>Date: {metadata.issueDate ?? "-"}</p>
          <p>Due date: {metadata.dueDate ?? "-"}</p>
        </div>
      </div>

      <div className="rounded-md bg-slate-100 p-3">
        <p className="text-xs font-semibold uppercase text-slate-500">Subject</p>
        <p className="mt-1 text-sm text-slate-700">{metadata.subject ?? "-"}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">Supplier</p>
        <PartyPreview data={metadata.supplier} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {summaryEntries.map(([label, value]) => (
          <div key={label} className="rounded-md border border-slate-200 px-3 py-2 text-xs">
            <p className="font-semibold uppercase text-slate-500">{label}</p>
            <p className="mt-1 text-slate-700">{value && value.length > 0 ? value : "-"}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-slate-500">Requested Items</p>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 text-left font-semibold text-slate-600">#</th>
              <th className="py-2 text-left font-semibold text-slate-600">Description</th>
              <th className="py-2 text-right font-semibold text-slate-600">Quantity</th>
              <th className="py-2 text-left font-semibold text-slate-600">Notes</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item, index) => (
              <tr key={`preview-item-${index}`} className="border-b border-slate-100">
                <td className="py-2 text-slate-500">{item.itemNumber ?? index + 1}</td>
                <td className="py-2 text-slate-700 whitespace-pre-wrap">{item.richDescription ?? item.description}</td>
                <td className="py-2 text-right text-slate-700">{formatNumber(item.quantity)}</td>
                <td className="py-2 text-slate-600 whitespace-pre-wrap">{item.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {metadata.packingRequirements ? (
        <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
          <p className="font-semibold uppercase text-slate-500">Packing requirements</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{metadata.packingRequirements}</p>
        </div>
      ) : null}

      {metadata.accessoriesInclusions ? (
        <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
          <p className="font-semibold uppercase text-slate-500">Accessories / Inclusions</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{metadata.accessoriesInclusions}</p>
        </div>
      ) : null}

      {quote.remarks ? (
        <div className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
          <p className="font-semibold uppercase text-slate-500">Notes for Supplier</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{quote.remarks}</p>
        </div>
      ) : null}

      {reviewer ? <p className="text-xs text-slate-500">Reviewed by: {reviewer}</p> : null}
    </div>
  );
}

function PartyPreview({ data }: { data?: QuoteExtraction["metadata"]["supplier"] }) {
  if (!data) {
    return <p className="text-slate-400">No information provided</p>;
  }

  const lines = [data.companyName, data.name, data.address, data.phone, data.email, data.website, data.taxId].filter(Boolean);
  if (lines.length === 0) {
    return <p className="text-slate-400">No information provided</p>;
  }

  return (
    <div className="mt-1 space-y-1 text-slate-600">
      {lines.map((line, idx) => (
        <p key={`preview-line-${idx}`}>{line}</p>
      ))}
    </div>
  );
}

function prepareQuoteForDocument(quote: QuoteExtraction): QuoteExtraction {
  const ensureSupplier = (supplier?: QuoteExtraction["metadata"]["supplier"]): QuoteExtraction["metadata"]["supplier"] => ({
    name: supplier?.name ?? "",
    companyName: supplier?.companyName ?? "",
    address: supplier?.address ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    website: supplier?.website ?? "",
    taxId: supplier?.taxId ?? "",
  });

  return {
    ...quote,
    remarks: quote.remarks ?? "",
    metadata: {
      supplier: ensureSupplier(quote.metadata?.supplier),
      rfqNumber: quote.metadata?.rfqNumber ?? "",
      issueDate: quote.metadata?.issueDate ?? "",
      dueDate: quote.metadata?.dueDate ?? "",
      subject: quote.metadata?.subject ?? "",
      packing: quote.metadata?.packing ?? "Export seaworthy",
      deliveryTerms: quote.metadata?.deliveryTerms ?? "Your best",
      currency: quote.metadata?.currency ?? "EUR/USD",
      paymentTerms: quote.metadata?.paymentTerms ?? "To be agreed",
      guarantees: quote.metadata?.guarantees ?? "12/18 months",
      origin: quote.metadata?.origin ?? "TBA",
      packingRequirements: quote.metadata?.packingRequirements ?? "",
      accessoriesInclusions: quote.metadata?.accessoriesInclusions ?? "",
    },
    items: quote.items.map((item) => ({
      itemNumber: item.itemNumber ?? "",
      description: item.description,
      quantity: item.quantity ?? null,
      notes: item.notes ?? "",
      richDescription: item.richDescription ?? "",
    })),
  };
}

function parseNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalised = trimmed.replace(/,/g, ".");
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "";
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
