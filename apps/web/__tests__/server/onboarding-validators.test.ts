import { describe, it, expect } from 'vitest';
import {
  validateFssai, validateGstin, gstinCheckChar, validatePan, validateGstinMatchesPan,
  validateIndianPhone, validatePinCode, validateHexColor, validateIndiaLatLng, validateEmail,
} from '@/lib/onboarding/validators';

describe('onboarding validators', () => {
  it('FSSAI: 14 digits starting 1 or 2', () => {
    expect(validateFssai('10020042007183')).toBeNull();
    expect(validateFssai('2002 0042 0071 83')).toBeNull(); // spaces tolerated
    expect(validateFssai('')).toMatch(/required/);
    expect(validateFssai('1002004200718')).toMatch(/exactly 14 digits/);
    expect(validateFssai('90020042007183')).toMatch(/start with 1/);
  });

  it('GSTIN: format, state code and mod-36 checksum', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(validateGstin('27AAPFU0939F1ZV')).toBeNull();
    expect(validateGstin('29aagcb7383j1z4')).toBeNull(); // case-insensitive
    expect(validateGstin('')).toBeNull(); // optional
    expect(validateGstin('27AAPFU0939F1ZW')).toMatch(/checksum/);
    expect(validateGstin('99AAPFU0939F1ZV')).toMatch(/state code/);
    expect(validateGstin('27AAPFU0939F1V')).toMatch(/15 characters/);
    expect(validateGstin('27AAPFU0939F1XV')).toMatch(/does not look like/);
  });

  it('PAN and GSTIN↔PAN consistency', () => {
    expect(validatePan('AAPFU0939F')).toBeNull();
    expect(validatePan('AAPF0939FU')).toMatch(/10 characters/);
    expect(validateGstinMatchesPan('27AAPFU0939F1ZV', 'AAPFU0939F')).toBeNull();
    expect(validateGstinMatchesPan('27AAPFU0939F1ZV', 'ABCDE1234F')).toMatch(/differs/);
  });

  it('phone, PIN, email, colour, coordinates', () => {
    expect(validateIndianPhone('+91 98765 43210')).toBeNull();
    expect(validateIndianPhone('09876543210')).toBeNull();
    expect(validateIndianPhone('12345')).toMatch(/10-digit/);
    expect(validateIndianPhone('', { required: true })).toMatch(/required/);
    expect(validateIndianPhone('')).toBeNull();
    expect(validatePinCode('560034')).toBeNull();
    expect(validatePinCode('060034')).toMatch(/6 digits/);
    expect(validateEmail('a@b.in')).toBeNull();
    expect(validateEmail('a@b')).toMatch(/incomplete/);
    expect(validateHexColor('#E23744')).toBeNull();
    expect(validateHexColor('red')).toMatch(/hex/);
    expect(validateIndiaLatLng(12.97, 77.59)).toBeNull();
    expect(validateIndiaLatLng(77.59, 12.97)).toMatch(/swap/);
    expect(validateIndiaLatLng(null, 77)).toMatch(/required/);
  });
});
