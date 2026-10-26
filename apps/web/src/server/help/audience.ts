/**
 * Which help-article audiences a viewer may read. Pure — no DB.
 *
 *   ADMIN (restaurant owner/staff) → RESTAURANT_ADMIN + KITCHEN + ALL
 *   KITCHEN                         → KITCHEN + ALL
 *   RIDER                           → RIDER + ALL
 *   CUSTOMER / signed out           → CUSTOMER + ALL
 *   SUPER_ADMIN                     → everything (authoring preview)
 *   other platform roles            → CUSTOMER + ALL (no special access)
 */
import type { HelpAudience, HelpLanguage } from '@prisma/client';

export const ALL_AUDIENCES: HelpAudience[] = ['RESTAURANT_ADMIN', 'KITCHEN', 'RIDER', 'CUSTOMER', 'ALL'];

export function audiencesForRole(role: string | null | undefined): HelpAudience[] {
  switch (role) {
    case 'SUPER_ADMIN':
      return ALL_AUDIENCES;
    case 'ADMIN':
      return ['RESTAURANT_ADMIN', 'KITCHEN', 'ALL'];
    case 'KITCHEN':
      return ['KITCHEN', 'ALL'];
    case 'RIDER':
      return ['RIDER', 'ALL'];
    default:
      return ['CUSTOMER', 'ALL'];
  }
}

export function parseLanguage(v: string | null | undefined): HelpLanguage {
  return v === 'hi' ? 'hi' : 'en';
}

