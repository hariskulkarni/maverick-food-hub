/**
 * Brand design tokens for the Flavrly rider app.
 * Vibrant Coral + Berry — matching the Flavrly web platform.
 */

export const colors = {
  primary: '#f23e5c',        // coral-raspberry — primary actions, brand
  primaryDark: '#c01e44',    // pressed state
  primarySoft: '#ffe4ea',    // tinted backgrounds, chips

  bg: '#fff7f8',             // warm pink-white — app background
  card: '#ffffff',           // surfaces, inputs
  text: '#26121f',           // primary text — berry-ink
  textMuted: '#8a6f7b',      // secondary text
  border: '#f1dfe6',         // hairlines, input borders

  success: '#17a06b',        // fresh green — online, delivered
  successSoft: '#e6f6ef',
  danger: '#dc2640',         // errors, failed states
  dangerSoft: '#fdeaec',
  warning: '#e0892a',
  warningSoft: '#fff4e5',

  white: '#ffffff',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const;

export const font = {
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 28,
    xxl: 34,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

/** Soft elevation used on cards and the primary button. */
export const shadow = {
  card: {
    shadowColor: '#3a2f1f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
} as const;
