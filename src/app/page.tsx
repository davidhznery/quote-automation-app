"use client";

import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { defaultBranding } from "@/config/branding";
import { computeTotals } from "@/lib/quoteSchema";
import type { BrandingProfile, QuoteExtraction, QuoteItem, QuoteTotals } from "@/types/quote";

interface UploadState {
  isDragging: boolean;
}

const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/tiff"];

export default function Home() {
  const [quote, setQuote] = useState<QuoteExtraction | null>(null);
  const [brand, setBrand] = useState<BrandingProfile>(defaultBranding);
  const [reviewer, setReviewer] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>({ isDragging: false });
  const [isProcessing, setProcessing] = useState(false);
  const [isDownloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const totals = useMemo(() => (quote ? computeTotals(quote.items, quote.totals) : null), [quote]);

  const handleFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Formato no soportado. Usa PDF o imagen (png, jpg, webp, tiff).");
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
        const payload = await response.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(payload.error ?? "Fallo al procesar la cotizacion");
      }

      const payload = await response.json();
      setQuote(payload.data as QuoteExtraction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fallo inesperado";
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

  const handlePartyChange = (party: "supplier" | "customer", field: keyof NonNullable<QuoteExtraction["metadata"]["supplier"]>, value: string) => {
    if (!quote) return;
    const current = quote.metadata[party] ?? {};
    const updated = { ...current, [field]: value.length ? value : undefined };
    setQuote({
      ...quote,
      metadata: {
        ...quote.metadata,
        [party]: updated,
      },
    });
  };

  const handleItemChange = (index: number, field: keyof QuoteItem, value: string) => {
    if (!quote) return;

    const updatedItems = quote.items.map((item, idx) => {
      if (idx !== index) return item;
      if (field === "description" || field === "itemNumber" || field === "notes") {
        return { ...item, [field]: value.length ? value : undefined };
      }

      const numericValue = parseNumberInput(value);
      const nextItem: QuoteItem = {
        ...item,
        [field]: numericValue,
      };

      if ((field === "quantity" || field === "unitPrice") && nextItem.quantity != null && nextItem.unitPrice != null) {
        nextItem.totalPrice = Number((nextItem.quantity * nextItem.unitPrice).toFixed(2));
      }

      if (field === "totalPrice" && numericValue == null && nextItem.quantity != null && nextItem.unitPrice != null) {
        nextItem.totalPrice = Number((nextItem.quantity * nextItem.unitPrice).toFixed(2));
      }

      return nextItem;
    });

    setQuote({
      ...quote,
      items: updatedItems,
    });
  };

  const handleTotalsChange = (field: keyof QuoteTotals, value: string) => {
    if (!quote) return;
    const numericValue = parseNumberInput(value);
    setQuote({
      ...quote,
      totals: {
        ...quote.totals,
        [field]: numericValue,
      },
    });
  };

  const addItem = () => {
    if (!quote) return;
    setQuote({
      ...quote,
      items: [
        ...quote.items,
        {
          description: "",
          itemNumber: String(quote.items.length + 1),
          quantity: null,
          unitPrice: null,
          totalPrice: null,
          notes: undefined,
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

  const handleDownload = async () => {
    if (!quote) return;
    setDownloading(true);
    setError(null);

    try {
      const response = await fetch("/api/render-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote, brand, reviewer }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "No se pudo generar el PDF" }));
        throw new Error(payload.error ?? "No se pudo generar el PDF");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filename = quote.metadata.quoteNumber ? `cotizacion-${quote.metadata.quoteNumber}.pdf` : "cotizacion.pdf";
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo descargar";
      setError(message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold text-slate-900">Automatiza tus cotizaciones</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Sube un PDF o imagen con la cotizacion de tu cliente. El sistema extrae los datos con OpenAI, los coloca en tu
            plantilla y te permite revisarlos antes de generar el PDF final.
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
            className={`flex h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition ${
              uploadState.isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-400"
            }`}
          >
            <input type="file" accept={ACCEPTED_TYPES.join(",")} className="hidden" onChange={onSelect} />
            <span className="text-base font-medium text-slate-900">
              {isProcessing ? "Procesando la cotizacion..." : "Arrastra tu archivo o haz clic para buscar"}
            </span>
            <span className="mt-2 text-xs text-slate-500">Formatos aceptados: PDF, PNG, JPG, WEBP, TIFF (max 15 MB).</span>
          </label>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>

        {quote ? (
          <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)]">
            <div className="space-y-8">
              <Card title="Datos de la cotizacion">
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label="Numero de cotizacion"
                    value={quote.metadata.quoteNumber ?? ""}
                    onChange={(value) => handleMetadataChange("quoteNumber", value)}
                  />
                  <TextField
                    label="Fecha de emision"
                    value={quote.metadata.issueDate ?? ""}
                    onChange={(value) => handleMetadataChange("issueDate", value)}
                    placeholder="2025-09-17"
                  />
                  <TextField
                    label="Validez"
                    value={quote.metadata.expirationDate ?? ""}
                    onChange={(value) => handleMetadataChange("expirationDate", value)}
                    placeholder="30 dias"
                  />
                  <TextField
                    label="Moneda"
                    value={quote.metadata.currency ?? ""}
                    onChange={(value) => handleMetadataChange("currency", value)}
                    placeholder="USD"
                  />
                  <TextField
                    label="Proyecto"
                    value={quote.metadata.projectName ?? ""}
                    onChange={(value) => handleMetadataChange("projectName", value)}
                  />
                  <TextField
                    label="Terminos de pago"
                    value={quote.metadata.paymentTerms ?? ""}
                    onChange={(value) => handleMetadataChange("paymentTerms", value)}
                  />
                  <TextField
                    label="Terminos de entrega"
                    value={quote.metadata.deliveryTerms ?? ""}
                    onChange={(value) => handleMetadataChange("deliveryTerms", value)}
                  />
                  <TextField
                    label="Notas adicionales"
                    value={quote.metadata.additionalNotes ?? ""}
                    onChange={(value) => handleMetadataChange("additionalNotes", value)}
                  />
                </div>
              </Card>

              <div className="grid gap-6 md:grid-cols-2">
                <Card title="Proveedor">
                  <PartyForm
                    data={quote.metadata.supplier ?? {}}
                    onChange={(field, value) => handlePartyChange("supplier", field, value)}
                  />
                </Card>
                <Card title="Cliente">
                  <PartyForm
                    data={quote.metadata.customer ?? {}}
                    onChange={(field, value) => handlePartyChange("customer", field, value)}
                  />
                </Card>
              </div>

              <Card title="Items">
                <div className="space-y-4">
                  {quote.items.map((item, index) => (
                    <div key={index} className="rounded-lg border border-slate-200 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="grid flex-1 gap-3 md:grid-cols-2">
                          <TextField
                            label="Codigo"
                            value={item.itemNumber ?? ""}
                            onChange={(value) => handleItemChange(index, "itemNumber", value)}
                          />
                          <TextField
                            label="Descripcion"
                            value={item.description}
                            onChange={(value) => handleItemChange(index, "description", value)}
                            required
                          />
                          <NumberField
                            label="Cantidad"
                            value={item.quantity}
                            onChange={(value) => handleItemChange(index, "quantity", value)}
                          />
                          <NumberField
                            label="Precio unitario"
                            value={item.unitPrice}
                            onChange={(value) => handleItemChange(index, "unitPrice", value)}
                          />
                          <NumberField
                            label="Total"
                            value={item.totalPrice}
                            onChange={(value) => handleItemChange(index, "totalPrice", value)}
                          />
                          <TextField
                            label="Notas"
                            value={item.notes ?? ""}
                            onChange={(value) => handleItemChange(index, "notes", value)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addItem}
                    className="w-full rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-600"
                  >
                    Agregar item
                  </button>
                </div>
              </Card>

              <Card title="Totales">
                <div className="grid gap-4 md:grid-cols-2">
                  <NumberField
                    label="Subtotal"
                    value={quote.totals.subtotal ?? totals?.subtotal ?? null}
                    onChange={(value) => handleTotalsChange("subtotal", value)}
                  />
                  <NumberField
                    label="Impuestos"
                    value={quote.totals.taxes ?? null}
                    onChange={(value) => handleTotalsChange("taxes", value)}
                  />
                  <NumberField
                    label="Envio"
                    value={quote.totals.shipping ?? null}
                    onChange={(value) => handleTotalsChange("shipping", value)}
                  />
                  <NumberField
                    label="Descuento"
                    value={quote.totals.discount ?? null}
                    onChange={(value) => handleTotalsChange("discount", value)}
                  />
                  <NumberField
                    label="Total"
                    value={quote.totals.total ?? totals?.total ?? null}
                    onChange={(value) => handleTotalsChange("total", value)}
                  />
                </div>
                {totals ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Totales calculados automaticamente: Subtotal {formatCurrency(totals.subtotal, quote.metadata.currency)} / Total {" "}
                    {formatCurrency(totals.total, quote.metadata.currency)}
                  </p>
                ) : null}
              </Card>

              <Card title="Plantilla de la empresa">
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label="Nombre comercial"
                    value={brand.companyName}
                    onChange={(value) => setBrand({ ...brand, companyName: value })}
                    required
                  />
                  <TextField
                    label="Color principal"
                    value={brand.primaryColor}
                    onChange={(value) => setBrand({ ...brand, primaryColor: value })}
                  />
                  <TextField
                    label="Color de acento"
                    value={brand.accentColor}
                    onChange={(value) => setBrand({ ...brand, accentColor: value })}
                  />
                  <TextField
                    label="Ruta del logo"
                    value={brand.logoRelativePath}
                    onChange={(value) => setBrand({ ...brand, logoRelativePath: value })}
                    helper="Coloca tu logo en /public y ajusta la ruta"
                  />
                  <TextAreaField
                    label="Direccion (una linea por fila)"
                    value={brand.addressLines.join("\n")}
                    onChange={(value) => setBrand({ ...brand, addressLines: splitLines(value) })}
                  />
                  <TextAreaField
                    label="Contacto (una linea por fila)"
                    value={brand.contactLines.join("\n")}
                    onChange={(value) => setBrand({ ...brand, contactLines: splitLines(value) })}
                  />
                  <TextField label="Revisado por" value={reviewer} onChange={setReviewer} placeholder="Nombre del responsable" />
                </div>
              </Card>

              <Card title="Notas">
                <TextAreaField
                  label="Comentarios finales"
                  value={quote.remarks ?? ""}
                  onChange={(value) => setQuote({ ...quote, remarks: value.length ? value : undefined })}
                />
                <button
                  type="button"
                  onClick={() => setShowRaw((prev) => !prev)}
                  className="mt-3 text-xs text-blue-600 underline"
                >
                  {showRaw ? "Ocultar texto extraido" : "Ver texto completo extraido"}
                </button>
                {showRaw ? (
                  <pre className="mt-3 max-h-60 overflow-y-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                    {quote.fullText}
                  </pre>
                ) : null}
              </Card>
            </div>

            <aside className="space-y-6">
              <Card title="Previsualizacion">
                <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                  <PreviewDocument quote={quote} brand={brand} totals={totals ?? quote.totals} reviewer={reviewer} />
                </div>
              </Card>

              <button
                type="button"
                disabled={isDownloading}
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
              >
                {isDownloading ? "Generando PDF..." : "Descargar PDF"}
              </button>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 space-y-4 text-sm text-slate-700">{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  helper?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      <span className="font-medium text-slate-800">
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </span>
      <input
        className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
      />
      {helper ? <span className="text-xs text-slate-400">{helper}</span> : null}
    </label>
  );
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      <span className="font-medium text-slate-800">{label}</span>
      <textarea
        className="min-h-[90px] rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      <span className="font-medium text-slate-800">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        value={value ?? ""}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function PartyForm({
  data,
  onChange,
}: {
  data: NonNullable<QuoteExtraction["metadata"]["supplier"]>;
  onChange: (field: keyof NonNullable<QuoteExtraction["metadata"]["supplier"]>, value: string) => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <TextField label="Empresa" value={data.companyName ?? ""} onChange={(value) => onChange("companyName", value)} />
      <TextField label="Contacto" value={data.name ?? ""} onChange={(value) => onChange("name", value)} />
      <TextAreaField label="Direccion" value={data.address ?? ""} onChange={(value) => onChange("address", value)} />
      <TextField label="Telefono" value={data.phone ?? ""} onChange={(value) => onChange("phone", value)} />
      <TextField label="Email" value={data.email ?? ""} onChange={(value) => onChange("email", value)} />
      <TextField label="Identificacion fiscal" value={data.taxId ?? ""} onChange={(value) => onChange("taxId", value)} />
    </div>
  );
}

function PreviewDocument({
  quote,
  brand,
  totals,
  reviewer,
}: {
  quote: QuoteExtraction;
  brand: BrandingProfile;
  totals: QuoteTotals;
  reviewer: string;
}) {
  return (
    <div className="space-y-4 text-sm text-slate-700">
      <div className="flex items-start justify-between gap-4">
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
        <div className="text-right text-xs text-slate-500">
          <p>Numero: {quote.metadata.quoteNumber ?? "-"}</p>
          <p>Fecha: {quote.metadata.issueDate ?? "-"}</p>
          <p>Validez: {quote.metadata.expirationDate ?? "-"}</p>
        </div>
      </div>

      <div className="grid gap-4 rounded-md bg-slate-100 p-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Proveedor</p>
          <PartyPreview data={quote.metadata.supplier} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Cliente</p>
          <PartyPreview data={quote.metadata.customer} />
        </div>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="py-2 text-left font-semibold text-slate-600">#</th>
            <th className="py-2 text-left font-semibold text-slate-600">Descripcion</th>
            <th className="py-2 text-right font-semibold text-slate-600">Cantidad</th>
            <th className="py-2 text-right font-semibold text-slate-600">Unitario</th>
            <th className="py-2 text-right font-semibold text-slate-600">Total</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item, index) => (
            <tr key={`preview-item-${index}`} className="border-b border-slate-100">
              <td className="py-2 text-slate-500">{index + 1}</td>
              <td className="py-2 text-slate-700">{item.description}</td>
              <td className="py-2 text-right text-slate-700">{formatNumber(item.quantity)}</td>
              <td className="py-2 text-right text-slate-700">{formatCurrency(item.unitPrice, quote.metadata.currency)}</td>
              <td className="py-2 text-right text-slate-700">{formatCurrency(item.totalPrice, quote.metadata.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-1 text-xs text-slate-600">
        {totals.subtotal != null ? (
          <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(totals.subtotal, quote.metadata.currency)}</span></div>
        ) : null}
        {totals.taxes != null ? (
          <div className="flex justify-between"><span>Impuestos</span><span>{formatCurrency(totals.taxes, quote.metadata.currency)}</span></div>
        ) : null}
        {totals.shipping != null ? (
          <div className="flex justify-between"><span>Envio</span><span>{formatCurrency(totals.shipping, quote.metadata.currency)}</span></div>
        ) : null}
        {totals.discount != null ? (
          <div className="flex justify-between"><span>Descuento</span><span>{formatCurrency(-Math.abs(totals.discount), quote.metadata.currency)}</span></div>
        ) : null}
        {totals.total != null ? (
          <div className="flex justify-between text-sm font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatCurrency(totals.total, quote.metadata.currency)}</span>
          </div>
        ) : null}
      </div>

      {quote.remarks ? (
        <div className="rounded-md bg-slate-100 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">Notas</p>
          <p className="mt-1 whitespace-pre-wrap">{quote.remarks}</p>
        </div>
      ) : null}

      {reviewer ? <p className="text-xs text-slate-500">Revisado por: {reviewer}</p> : null}
    </div>
  );
}

function PartyPreview({ data }: { data?: QuoteExtraction["metadata"]["supplier"] }) {
  if (!data) {
    return <p className="text-slate-400">Sin informacion</p>;
  }

  const lines = [data.companyName, data.name, data.address, data.phone, data.email, data.taxId].filter(Boolean);
  if (lines.length === 0) {
    return <p className="text-slate-400">Sin informacion</p>;
  }

  return (
    <div className="mt-1 space-y-1 text-slate-600">
      {lines.map((line, idx) => (
        <p key={`preview-line-${idx}`}>{line}</p>
      ))}
    </div>
  );
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
  return Number(value).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
