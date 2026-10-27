import { describe, it, expect } from 'vitest';
import {
  toNationalDigits,
  toIndianE164,
  nationalFromE164,
  isValidIndianMobile,
  formatIndianMobile,
  sanitizeOtp,
  applyOtpInput,
  applyOtpBackspace,
  isCompleteOtp,
} from '@/lib/customer-auth';

describe('phone helpers', () => {
  it('reduces typed and pasted numbers to 10 national digits', () => {
    expect(toNationalDigits('98765 43210')).toBe('9876543210');
    expect(toNationalDigits('+91 98765-43210')).toBe('9876543210');
    expect(toNationalDigits('919876543210')).toBe('9876543210');
    expect(toNationalDigits('09876543210')).toBe('9876543210');
    expect(toNationalDigits('98765432109999')).toBe('9876543210');
    expect(toNationalDigits('')).toBe('');
  });

  it('produces the same +91 form the auth calls already expect', () => {
    expect(toIndianE164('9876500001')).toBe('+919876500001');
    expect(toIndianE164('+919876500001')).toBe('+919876500001');
    expect(toIndianE164('')).toBe('');
    // still passes the existing client-side check in the sign-in handlers
    expect(/^\+?\d{10,15}$/.test(toIndianE164('9876500001'))).toBe(true);
  });

  it('shows only the typed national digits for a partial +91 value (no stray 91)', () => {
    expect(nationalFromE164('+919')).toBe('9');
    expect(nationalFromE164('+91919')).toBe('919');
    expect(nationalFromE164('+919876543210')).toBe('9876543210');
    // Typing digit by digit through the field round-trips cleanly.
    let v = '';
    for (const ch of '9198765432') v = toIndianE164(nationalFromE164(v) + ch);
    expect(v).toBe('+919198765432');
  });

  it('validates Indian mobiles', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('+919876543210')).toBe(true);
    expect(isValidIndianMobile('5876543210')).toBe(false);
    expect(isValidIndianMobile('98765')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatIndianMobile('+919876543210')).toBe('+91 98765 43210');
    expect(formatIndianMobile('123')).toBe('123');
  });
});

describe('OTP helpers', () => {
  it('sanitizes to six digits', () => {
    expect(sanitizeOtp('12a3 45678')).toBe('123456');
  });

  it('types one digit at a time and advances focus', () => {
    let s = applyOtpInput('', 0, '4');
    expect(s).toEqual({ code: '4', focus: 1 });
    s = applyOtpInput(s.code, 1, '2');
    expect(s).toEqual({ code: '42', focus: 2 });
  });

  it('fills every box from a paste or SMS autofill, starting where it landed', () => {
    expect(applyOtpInput('', 0, '123456')).toEqual({ code: '123456', focus: 5 });
    expect(applyOtpInput('', 0, 'Code: 654-321')).toEqual({ code: '654321', focus: 5 });
    expect(applyOtpInput('9', 1, '87654321')).toEqual({ code: '987654', focus: 5 });
  });

  it('ignores non-digit keystrokes', () => {
    expect(applyOtpInput('12', 2, 'x')).toEqual({ code: '12', focus: 2 });
  });

  it('backspace clears the current box, then steps back', () => {
    expect(applyOtpBackspace('123', 2)).toEqual({ code: '12', focus: 2 });
    expect(applyOtpBackspace('12', 2)).toEqual({ code: '1', focus: 1 });
    expect(applyOtpBackspace('', 0)).toEqual({ code: '', focus: 0 });
  });

  it('knows when the code is complete', () => {
    expect(isCompleteOtp('123456')).toBe(true);
    expect(isCompleteOtp('12345')).toBe(false);
    expect(isCompleteOtp('12 456')).toBe(false);
  });
});
