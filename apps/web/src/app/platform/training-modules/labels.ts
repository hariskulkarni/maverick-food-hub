export type Audience = 'RIDER' | 'KITCHEN' | 'RESTAURANT_ADMIN';

export const AUDIENCE_LABEL: Record<Audience, string> = {
  RIDER: 'Riders',
  KITCHEN: 'Kitchen staff',
  RESTAURANT_ADMIN: 'Restaurant admins',
};

export const CATEGORY_LABEL: Record<string, string> = {
  ONBOARDING: 'Onboarding',
  SAFETY: 'Safety',
  CUSTOMER_SERVICE: 'Customer service',
  EARNINGS: 'Earnings & cash',
  APP_GUIDE: 'App guide',
  HYGIENE: 'Food safety & hygiene',
  KITCHEN_OPS: 'Kitchen operations',
  RESTAURANT_OPS: 'Restaurant operations',
};

const BY_AUDIENCE: Record<Audience, string[]> = {
  RIDER: ['SAFETY', 'APP_GUIDE', 'CUSTOMER_SERVICE', 'EARNINGS', 'ONBOARDING'],
  KITCHEN: ['HYGIENE', 'KITCHEN_OPS', 'SAFETY'],
  RESTAURANT_ADMIN: ['RESTAURANT_OPS', 'HYGIENE', 'CUSTOMER_SERVICE'],
};

export function categoriesFor(a: Audience): string[] {
  return BY_AUDIENCE[a];
}
