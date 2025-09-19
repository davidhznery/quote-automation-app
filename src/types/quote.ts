export interface SupplierDetails {
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
  unit?: string | null;
  notes?: string;
  richDescription?: string | null;
}

export interface QuoteMetadata {
  supplier?: SupplierDetails;
  rfqNumber?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  subject?: string | null;
  packing?: string | null;
  deliveryTerms?: string | null;
  currency?: string | null;
  paymentTerms?: string | null;
  guarantees?: string | null;
  origin?: string | null;
  packingRequirements?: string | null;
  accessoriesInclusions?: string | null;
}

export interface QuoteExtraction {
  fullText: string;
  metadata: QuoteMetadata;
  items: QuoteItem[];
  remarks?: string | null;
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

