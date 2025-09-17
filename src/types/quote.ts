export interface PartyDetails {
  name?: string;
  companyName?: string;
  address?: string;
  phone?: string;
  email?: string;
  taxId?: string;
}

export interface QuoteItem {
  itemNumber?: string | null;
  description: string;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  notes?: string;
}

export interface QuoteTotals {
  subtotal?: number | null;
  taxes?: number | null;
  shipping?: number | null;
  discount?: number | null;
  total?: number | null;
}

export interface QuoteMetadata {
  supplier?: PartyDetails;
  customer?: PartyDetails;
  quoteNumber?: string;
  issueDate?: string;
  expirationDate?: string;
  currency?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  projectName?: string;
  additionalNotes?: string;
}

export interface QuoteExtraction {
  fullText: string;
  metadata: QuoteMetadata;
  items: QuoteItem[];
  totals: QuoteTotals;
  remarks?: string;
}

export interface QuoteDocumentRequest {
  quote: QuoteExtraction;
  brand?: Partial<BrandingProfile>;
  reviewer?: string;
}

export interface BrandingProfile {
  companyName: string;
  addressLines: string[];
  contactLines: string[];
  logoRelativePath: string;
  primaryColor: string;
  accentColor: string;
}