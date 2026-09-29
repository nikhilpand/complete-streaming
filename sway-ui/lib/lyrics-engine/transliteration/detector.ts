/**
 * detector.ts
 * Unicode Script Detection (Section 23)
 * Focused strictly on Devanagari (Hindi) and Gurmukhi (Punjabi).
 */

export type IndicScript =
  | 'Devanagari'
  | 'Gurmukhi'
  | 'Latin'
  | 'Unknown';

export function detectScript(text: string): IndicScript {
  if (!text) return 'Unknown';

  if (/[\u0900-\u097F]/.test(text)) return 'Devanagari';
  if (/[\u0A00-\u0A7F]/.test(text)) return 'Gurmukhi';
  if (/[a-zA-Z]/.test(text)) return 'Latin';

  return 'Unknown';
}

export function isDevanagariScript(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

export function isGurmukhiScript(text: string): boolean {
  return /[\u0A00-\u0A7F]/.test(text);
}

export function isNonLatinScript(text: string): boolean {
  return isDevanagariScript(text) || isGurmukhiScript(text);
}
