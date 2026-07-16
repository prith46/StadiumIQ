import { createClient, ChatMessage } from './client';
import { VISION_TICKET_PROMPT } from './prompts';

export interface LanguageDetectionResult {
  language: string;              // BCP-47 code, e.g. 'en', 'fr', 'pt-BR'
  confidence: 'high' | 'low';    // low if countryCode mapped to an ambiguous/multi-language country
  source: 'ticket_scan' | 'manual' | 'default';
  ticketData?: {
    section: string;
    gate: string;
    nationality: string;
    countryCode: string;
    seat?: string;
  };
}

// Fixed mapping table for World Cup 2026 participating nations (48 teams)
// Supports both 2-letter and 3-letter codes.
const WC_NATIONS_LANGUAGES: Record<string, { language: string; confidence: 'high' | 'low' }> = {
  // Hosts
  USA: { language: 'en', confidence: 'high' },
  US: { language: 'en', confidence: 'high' },
  MEX: { language: 'es', confidence: 'high' },
  MX: { language: 'es', confidence: 'high' },
  CAN: { language: 'en', confidence: 'low' }, // Multi-lingual (English/French)
  CA: { language: 'en', confidence: 'low' },

  // South America
  BRA: { language: 'pt', confidence: 'high' },
  BR: { language: 'pt', confidence: 'high' },
  ARG: { language: 'es', confidence: 'high' },
  AR: { language: 'es', confidence: 'high' },
  COL: { language: 'es', confidence: 'high' },
  CO: { language: 'es', confidence: 'high' },
  URU: { language: 'es', confidence: 'high' },
  UY: { language: 'es', confidence: 'high' },
  ECU: { language: 'es', confidence: 'high' },
  EC: { language: 'es', confidence: 'high' },
  VEN: { language: 'es', confidence: 'high' },
  VE: { language: 'es', confidence: 'high' },
  PAR: { language: 'es', confidence: 'high' },
  PY: { language: 'es', confidence: 'high' },
  PER: { language: 'es', confidence: 'high' },
  PE: { language: 'es', confidence: 'high' },
  CHI: { language: 'es', confidence: 'high' },
  CL: { language: 'es', confidence: 'high' },

  // Europe
  ENG: { language: 'en', confidence: 'high' },
  FRA: { language: 'fr', confidence: 'high' },
  FR: { language: 'fr', confidence: 'high' },
  GER: { language: 'de', confidence: 'high' },
  DE: { language: 'de', confidence: 'high' },
  ESP: { language: 'es', confidence: 'high' },
  ES: { language: 'es', confidence: 'high' },
  ITA: { language: 'it', confidence: 'high' },
  IT: { language: 'it', confidence: 'high' },
  POR: { language: 'pt', confidence: 'high' },
  PT: { language: 'pt', confidence: 'high' },
  NED: { language: 'nl', confidence: 'high' },
  NL: { language: 'nl', confidence: 'high' },
  BEL: { language: 'nl', confidence: 'low' }, // Multi-lingual (Dutch/French)
  BE: { language: 'nl', confidence: 'low' },
  CRO: { language: 'hr', confidence: 'high' },
  HR: { language: 'hr', confidence: 'high' },
  SUI: { language: 'de', confidence: 'low' }, // Multi-lingual (German/French/Italian)
  CH: { language: 'de', confidence: 'low' },
  DEN: { language: 'da', confidence: 'high' },
  DK: { language: 'da', confidence: 'high' },
  SWE: { language: 'sv', confidence: 'high' },
  SE: { language: 'sv', confidence: 'high' },
  POL: { language: 'pl', confidence: 'high' },
  PL: { language: 'pl', confidence: 'high' },
  UKR: { language: 'uk', confidence: 'high' },
  UA: { language: 'uk', confidence: 'high' },
  SCO: { language: 'en', confidence: 'high' },
  WAL: { language: 'en', confidence: 'low' },

  // Africa
  SEN: { language: 'fr', confidence: 'high' },
  SN: { language: 'fr', confidence: 'high' },
  MAR: { language: 'ar', confidence: 'low' }, // Multi-lingual (Arabic/French)
  MA: { language: 'ar', confidence: 'low' },
  TUN: { language: 'ar', confidence: 'high' },
  TN: { language: 'ar', confidence: 'high' },
  DZA: { language: 'ar', confidence: 'high' },
  DZ: { language: 'ar', confidence: 'high' },
  EGY: { language: 'ar', confidence: 'high' },
  EG: { language: 'ar', confidence: 'high' },
  NGA: { language: 'en', confidence: 'high' },
  NG: { language: 'en', confidence: 'high' },
  CMR: { language: 'fr', confidence: 'low' }, // Multi-lingual (French/English)
  CM: { language: 'fr', confidence: 'low' },
  GHA: { language: 'en', confidence: 'high' },
  GH: { language: 'en', confidence: 'high' },
  CIV: { language: 'fr', confidence: 'high' },
  CI: { language: 'fr', confidence: 'high' },
  ZAF: { language: 'en', confidence: 'low' }, // Multi-lingual
  ZA: { language: 'en', confidence: 'low' },

  // Asia/Oceania
  JPN: { language: 'ja', confidence: 'high' },
  JP: { language: 'ja', confidence: 'high' },
  KOR: { language: 'ko', confidence: 'high' },
  KR: { language: 'ko', confidence: 'high' },
  AUS: { language: 'en', confidence: 'high' },
  AU: { language: 'en', confidence: 'high' },
  KSA: { language: 'ar', confidence: 'high' },
  SA: { language: 'ar', confidence: 'high' },
  IRN: { language: 'fa', confidence: 'high' },
  IR: { language: 'fa', confidence: 'high' },
  QAT: { language: 'ar', confidence: 'high' },
  QA: { language: 'ar', confidence: 'high' },
  CHN: { language: 'zh', confidence: 'high' },
  CN: { language: 'zh', confidence: 'high' },
  NZL: { language: 'en', confidence: 'high' },
  NZ: { language: 'en', confidence: 'high' },
  IRQ: { language: 'ar', confidence: 'high' },
  IQ: { language: 'ar', confidence: 'high' },
  UAE: { language: 'ar', confidence: 'high' },
  AE: { language: 'ar', confidence: 'high' },
  OMN: { language: 'ar', confidence: 'high' },
  OM: { language: 'ar', confidence: 'high' },
  UZB: { language: 'uz', confidence: 'low' },
  UZ: { language: 'uz', confidence: 'low' },
};

/**
 * Pure, synchronous mapping lookup.
 * Fallbacks to English with low confidence if the countryCode is unrecognized.
 */
export function countryCodeToLanguage(countryCode: string): { language: string; confidence: 'high' | 'low' } {
  const code = countryCode.trim().toUpperCase();
  const match = WC_NATIONS_LANGUAGES[code];
  if (match) {
    return match;
  }
  return { language: 'en', confidence: 'low' };
}

/**
 * Server-side function. Calls the vision client to process ticket images.
 * Returns the LanguageDetectionResult or a clean error path if it fails.
 */
export async function detectLanguageFromTicket(
  imageBase64: string,
  mimeType: string = 'image/png'
): Promise<LanguageDetectionResult | { error: string }> {
  let client;
  try {
    client = createClient();
  } catch {
    return { error: 'Vision client initialization failed' };
  }

  if (!client.supportsVision) {
    return { error: 'Vision API unsupported by the current provider' };
  }

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: VISION_TICKET_PROMPT },
      { role: 'user', content: 'Extract the ticket metadata from the image.' }
    ];

    const result = await client.visionChat(messages, imageBase64, mimeType);
    if (!result.text) {
      return { error: 'Empty response from vision model' };
    }

    // Clean markdown fences
    let cleanJson = result.text.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
    }

    const rawObj = JSON.parse(cleanJson);

    // Injection Defense: STRICT extraction schema validation
    // Discard any unrecognized fields or adversarial commands by copying only expected keys.
    const extractedData = {
      section: typeof rawObj.section === 'string' ? rawObj.section : '',
      gate: typeof rawObj.gate === 'string' ? rawObj.gate : '',
      nationality: typeof rawObj.nationality === 'string' ? rawObj.nationality : '',
      countryCode: typeof rawObj.countryCode === 'string' ? rawObj.countryCode : '',
      seat: typeof rawObj.seat === 'string' ? rawObj.seat : undefined,
    };

    if (!extractedData.countryCode) {
      return { error: 'Could not extract country code from ticket' };
    }

    const mapping = countryCodeToLanguage(extractedData.countryCode);

    return {
      language: mapping.language,
      confidence: mapping.confidence,
      source: 'ticket_scan',
      ticketData: extractedData,
    };
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : 'Vision chat communication failed' };
  }
}
