const LANGUAGE_LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  es: "es-MX",
  pt: "pt-BR",
  fr: "fr-FR",
  ja: "ja-JP",
  ko: "ko-KR",
  de: "de-DE",
  it: "it-IT",
  nl: "nl-NL",
  hr: "hr-HR",
  da: "da-DK",
  sv: "sv-SE",
  pl: "pl-PL",
  uk: "uk-UA",
  ar: "ar-SA",
  fa: "fa-IR",
  zh: "zh-CN",
  uz: "uz-UZ",
};

/**
 * Maps a FanContext BCP-47 language code to a full Speech API locale tag.
 * Defaults to 'en-US' if the code is unknown.
 */
export function toSpeechLocaleTag(languageCode: string): string {
  const code = languageCode.trim().toLowerCase();
  return LANGUAGE_LOCALE_MAP[code] || "en-US";
}
