/**
 * detector.ts
 * Unicode Script Detection (Section 23)
 */

export type IndicScript =
  | 'Devanagari'
  | 'Gurmukhi'
  | 'Bengali'
  | 'Tamil'
  | 'Telugu'
  | 'ArabicUrdu'
  | 'Latin'
  | 'Unknown';

export function detectScript(text: string): IndicScript {
  if (!text) return 'Unknown';

  if (/[\u0900-\u097F]/.test(text)) return 'Devanagari';
  if (/[\u0A00-\u0A7F]/.test(text)) return 'Gurmukhi';
  if (/[\u0980-\u09FF]/.test(text)) return 'Bengali';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'Tamil';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'Telugu';
  if (/[\u0600-\u06FF]/.test(text)) return 'ArabicUrdu';
  if (/[a-zA-Z]/.test(text)) return 'Latin';

  return 'Unknown';
}

export function isDevanagariScript(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}
