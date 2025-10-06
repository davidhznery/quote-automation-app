import type { BrandingProfile, SupplierDetails } from "@/types/quote";

// Place company logos under public/branding so the relative paths below resolve in both the UI and PDF generator.
export interface CompanyProfile {
  id: string;
  label: string;
  branding: BrandingProfile;
  supplier: SupplierDetails;
}

const sosBranding: BrandingProfile = {
  companyName: "Superb Oil Stream Ltd",
  addressLines: ["Ferris Building No.1", "Floor 1, Triq San Luqa", "G'Mangia Pieta, PTA 1020", "Malta"],
  contactLines: ["Tel: +356 20100800", "info@superboilstream.com", "https://superboilstream.com"],
  logoRelativePath: "branding/sos-logo.png",
  primaryColor: "#0b2c52",
  accentColor: "#f97316",
};

const sosSupplier: SupplierDetails = {
  companyName: "Superb Oil Stream Ltd",
  address: "Ferris Building No.1, Floor 1, Triq San Luqa, G'Mangia Pieta, PTA 1020, Malta",
  phone: "+356 20100800",
  email: "info@superboilstream.com",
  website: "https://superboilstream.com",
  taxId: "C52977",
};

const dleBranding: BrandingProfile = {
  companyName: "Delta FZ LLE",
  addressLines: ["Office 1309, 13th Floor", "Fujairah - Creative Tower", "P.O.Box 4422", "United Arab Emirates"],
  contactLines: ["Tel: +971 9 2077666", "info@deltaunited.me", "https://deltaunited.me"],
  logoRelativePath: "branding/dle-logo.png",
  primaryColor: "#1f2937",
  accentColor: "#10b981",
};

const dleSupplier: SupplierDetails = {
  companyName: "Delta FZ LLE",
  address: "Office 1309, 13th Floor, Fujairah - Creative Tower, P.O.Box 4422, UAE",
  phone: "+971 9 2077666",
  email: "info@deltaunited.me",
  website: "https://deltaunited.me",
  taxId: "14596/2019",
};

const dugBranding: BrandingProfile = {
  companyName: "Delta United Group",
  addressLines: ["Tajoura Al Andalusy", "Alshat road P.O Box 30694", "Tripoli, Libya"],
  contactLines: ["Tel: +218 218213698092", "info@deltaunited.me", "https://deltaunited.me"],
  logoRelativePath: "branding/dug-logo.jpeg",
  primaryColor: "#0076a8",
  accentColor: "#004f75",
};

const dugSupplier: SupplierDetails = {
  companyName: "Delta United Group",
  address: "Tajoura Al Andalusy, Alshat road P.O Box 30694, Tripoli, Libya",
  phone: "+218 218213698092",
  email: "info@deltaunited.me",
  website: "https://deltaunited.me",
};

export const companyProfiles: CompanyProfile[] = [
  { id: "sos", label: "SOS - Superb Oil Stream", branding: sosBranding, supplier: sosSupplier },
  { id: "dle", label: "DLE - Delta FZ LLE", branding: dleBranding, supplier: dleSupplier },
  { id: "dug", label: "DUG - Delta United Group", branding: dugBranding, supplier: dugSupplier },
];

export const defaultCompanyProfile = companyProfiles[0];
