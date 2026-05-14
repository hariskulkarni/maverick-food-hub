/**
 * Brand design tokens for the Oak & Sizzler rider app.
 * Warm, food-forward palette — saffron on cream — matching the web platform.
 */

export const colors = {
  primary: '#ea5b1f',        // saffron — primary actions, brand
  primaryDark: '#c94a14',    // pressed state
  primarySoft: '#fdede4',    // tinted backgrounds, chips

  bg: '#f5f1e8',             // warm cream — app background
  card: '#ffffff',           // surfaces, inputs
  text: '#1f1b16',           // primary text — graphite
  textMuted: '#7a7060',      // secondary text
  border: '#e4ddcd',         // hairlines, input borders

  success: '#3f7d3f',        // moss green — online, delivered
  successSoft: '#e8f1e8',
  danger: '#c0392b',         // errors, failed states
  dangerSoft: '#fbeae8',
  warning: '#d98a1f',

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
