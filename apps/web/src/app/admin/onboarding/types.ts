/** Serialisable data the /admin/onboarding server page hands to the wizard. */
import type { OnboardingProgressDto } from '@/server/onboarding';
import type { ReadinessResult } from '@/lib/onboarding/readiness';
import type { StorefrontConfig } from '@/server/storefront-cms';

export interface OnbHours { dayOfWeek: number; openMin: number; closeMin: number }
export interface OnbZone { id: string; name: string; type: string; radiusKm: number | null; isActive: boolean; feeBrackets: unknown; distanceTiers: unknown; minOrder: number | null; etaMinutes: number | null }
export interface OnbBranch {
  id: string; name: string; isActive: boolean;
  line1: string; city: string; state: string | null; postalCode: string; phone: string | null;
  latitude: number | null; longitude: number | null; serviceRadiusKm: number;
  baseDeliveryFee: number; perKmDeliveryFee: number;
  fssaiLicenseNumber: string | null; fssaiLicenseType: string | null; fssaiExpiresOn: string | null; fssaiLicenseImageUrl: string | null;
  hours: OnbHours[];
  zones: OnbZone[];
}
export interface OnbRestaurant {
  id: string; slug: string; name: string; status: string;
  tagline: string | null; description: string | null; cuisine: string | null;
  contactEmail: string | null; contactPhone: string | null;
  logoUrl: string | null; coverImageUrl: string | null;
  legalName: string | null; gstin: string | null; pan: string | null;
  commissionPct: number; paymentFeePct: number; settlementCycle: string;
}
export interface OnbIntegration { provider: string; title: string; status: string }
export interface OnbStaff { id: string; name: string | null; email: string | null; role: string; isOwner: boolean }
export interface OnbMenuItem { name: string; description: string | null; price: number; isVeg: boolean; imageUrl: string | null; category: string; isAvailable: boolean }
export interface OnbMenu { categories: string[]; itemCount: number; availableCount: number; recent: OnbMenuItem[] }

export interface OnboardingData {
  restaurant: OnbRestaurant;
  storefront: StorefrontConfig;
  branches: OnbBranch[];
  menu: OnbMenu;
  staff: OnbStaff[];
  integrations: OnbIntegration[];
  qrCode: string | null;
  progress: OnboardingProgressDto;
  readiness: ReadinessResult;
}
