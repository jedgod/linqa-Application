// GDELT DOC 2.0 (`mode=artlist`) does not return machine codes for three
// fields the Home schema stores as codes:
//
//   seendate      "20260829T010000Z"  -- not ISO-8601; `new Date()` rejects it
//   sourcecountry "United Kingdom"    -- a name, but home_news_articles
//                                        .country_code is CHAR(2)
//   language      "English"           -- a name, not ISO 639-1
//
// Passing those through unchanged makes the whole feed fail closed: every
// article is rejected with INVALID_NEWS_PUBLISHED_AT, and any that survived
// would blow up the CHAR(2) insert. Normalization lives here (not in the
// provider) so the secondary provider and any future contracted provider get
// the same treatment, and so it is unit-testable without network access.

const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  afghanistan: "AF", albania: "AL", algeria: "DZ", andorra: "AD", angola: "AO",
  argentina: "AR", armenia: "AM", aruba: "AW", australia: "AU", austria: "AT",
  azerbaijan: "AZ", bahamas: "BS", "the bahamas": "BS", bahrain: "BH",
  bangladesh: "BD", barbados: "BB", belarus: "BY", belgium: "BE", belize: "BZ",
  benin: "BJ", bermuda: "BM", bhutan: "BT", bolivia: "BO",
  "bosnia and herzegovina": "BA", botswana: "BW", brazil: "BR", brunei: "BN",
  bulgaria: "BG", "burkina faso": "BF", burma: "MM", myanmar: "MM",
  burundi: "BI", cambodia: "KH", cameroon: "CM", canada: "CA",
  "cape verde": "CV", "cayman islands": "KY",
  "central african republic": "CF", chad: "TD", chile: "CL", china: "CN",
  colombia: "CO", comoros: "KM", "congo republic of the": "CG",
  "republic of the congo": "CG", congo: "CG",
  "congo democratic republic of the": "CD",
  "democratic republic of the congo": "CD", "costa rica": "CR",
  "cote divoire": "CI", "cote d ivoire": "CI", "ivory coast": "CI",
  croatia: "HR", cuba: "CU", curacao: "CW", cyprus: "CY",
  "czech republic": "CZ", czechia: "CZ", denmark: "DK", djibouti: "DJ",
  dominica: "DM", "dominican republic": "DO", ecuador: "EC", egypt: "EG",
  "el salvador": "SV", "equatorial guinea": "GQ", eritrea: "ER",
  estonia: "EE", eswatini: "SZ", swaziland: "SZ", ethiopia: "ET",
  "faroe islands": "FO", fiji: "FJ", finland: "FI", france: "FR",
  "french guiana": "GF", "french polynesia": "PF", gabon: "GA",
  gambia: "GM", "the gambia": "GM", georgia: "GE", germany: "DE",
  ghana: "GH", gibraltar: "GI", greece: "GR", greenland: "GL",
  grenada: "GD", guadeloupe: "GP", guam: "GU", guatemala: "GT",
  guernsey: "GG", guinea: "GN", "guinea bissau": "GW", guyana: "GY",
  haiti: "HT", honduras: "HN", "hong kong": "HK", hungary: "HU",
  iceland: "IS", india: "IN", indonesia: "ID", iran: "IR", iraq: "IQ",
  ireland: "IE", "isle of man": "IM", israel: "IL", italy: "IT",
  jamaica: "JM", japan: "JP", jersey: "JE", jordan: "JO", kazakhstan: "KZ",
  kenya: "KE", kiribati: "KI", "north korea": "KP",
  "korea north": "KP", "south korea": "KR", "korea south": "KR",
  kosovo: "XK", kuwait: "KW", kyrgyzstan: "KG", laos: "LA", latvia: "LV",
  lebanon: "LB", lesotho: "LS", liberia: "LR", libya: "LY",
  liechtenstein: "LI", lithuania: "LT", luxembourg: "LU", macau: "MO",
  macao: "MO", madagascar: "MG", malawi: "MW", malaysia: "MY",
  maldives: "MV", mali: "ML", malta: "MT", "marshall islands": "MH",
  martinique: "MQ", mauritania: "MR", mauritius: "MU", mexico: "MX",
  micronesia: "FM", moldova: "MD", monaco: "MC", mongolia: "MN",
  montenegro: "ME", montserrat: "MS", morocco: "MA", mozambique: "MZ",
  namibia: "NA", nauru: "NR", nepal: "NP", netherlands: "NL",
  "the netherlands": "NL", "new caledonia": "NC", "new zealand": "NZ",
  nicaragua: "NI", niger: "NE", nigeria: "NG",
  "north macedonia": "MK", macedonia: "MK", norway: "NO", oman: "OM",
  pakistan: "PK", palau: "PW", palestine: "PS",
  "west bank": "PS", "gaza strip": "PS", panama: "PA",
  "papua new guinea": "PG", paraguay: "PY", peru: "PE", philippines: "PH",
  poland: "PL", portugal: "PT", "puerto rico": "PR", qatar: "QA",
  reunion: "RE", romania: "RO", russia: "RU", "russian federation": "RU",
  rwanda: "RW", "saint kitts and nevis": "KN", "saint lucia": "LC",
  "saint vincent and the grenadines": "VC", samoa: "WS",
  "san marino": "SM", "sao tome and principe": "ST",
  "saudi arabia": "SA", senegal: "SN", serbia: "RS", seychelles: "SC",
  "sierra leone": "SL", singapore: "SG", "sint maarten": "SX",
  slovakia: "SK", slovenia: "SI", "solomon islands": "SB", somalia: "SO",
  "south africa": "ZA", "south sudan": "SS", spain: "ES",
  "sri lanka": "LK", sudan: "SD", suriname: "SR", sweden: "SE",
  switzerland: "CH", syria: "SY", taiwan: "TW", tajikistan: "TJ",
  tanzania: "TZ", thailand: "TH", "timor leste": "TL", "east timor": "TL",
  togo: "TG", tonga: "TO", "trinidad and tobago": "TT", tunisia: "TN",
  turkey: "TR", turkiye: "TR", turkmenistan: "TM",
  "turks and caicos islands": "TC", tuvalu: "TV", uganda: "UG",
  ukraine: "UA", "united arab emirates": "AE", "united kingdom": "GB",
  uk: "GB", "great britain": "GB", "united states": "US",
  "united states of america": "US", usa: "US", uruguay: "UY",
  uzbekistan: "UZ", vanuatu: "VU", "vatican city": "VA",
  "holy see": "VA", venezuela: "VE", vietnam: "VN",
  "virgin islands": "VI", "british virgin islands": "VG",
  "western sahara": "EH", yemen: "YE", zambia: "ZM", zimbabwe: "ZW"
};

const LANGUAGE_NAME_TO_ISO639: Record<string, string> = {
  albanian: "sq", arabic: "ar", armenian: "hy", azerbaijani: "az",
  belarusian: "be", bengali: "bn", bosnian: "bs", bulgarian: "bg",
  burmese: "my", catalan: "ca", chinese: "zh", croatian: "hr", czech: "cs",
  danish: "da", dutch: "nl", english: "en", estonian: "et", farsi: "fa",
  persian: "fa", finnish: "fi", french: "fr", galician: "gl", georgian: "ka",
  german: "de", greek: "el", gujarati: "gu", hebrew: "he", hindi: "hi",
  hungarian: "hu", icelandic: "is", indonesian: "id", italian: "it",
  japanese: "ja", kannada: "kn", kazakh: "kk", khmer: "km", korean: "ko",
  latvian: "lv", lithuanian: "lt", macedonian: "mk", malay: "ms",
  malayalam: "ml", marathi: "mr", mongolian: "mn", nepali: "ne",
  norwegian: "no", polish: "pl", portuguese: "pt", punjabi: "pa",
  romanian: "ro", russian: "ru", serbian: "sr", sinhala: "si", slovak: "sk",
  slovenian: "sl", somali: "so", spanish: "es", swahili: "sw", swedish: "sv",
  tagalog: "tl", tamil: "ta", telugu: "te", thai: "th", turkish: "tr",
  ukrainian: "uk", urdu: "ur", uzbek: "uz", vietnamese: "vi"
};

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns an uppercase ISO-3166-1 alpha-2 code, or undefined when the input
 * cannot be resolved. Undefined is deliberate: `country_code` is nullable and
 * an unattributed country is better than a wrong one.
 */
export function toIso2CountryCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_ISO2[normalizeKey(trimmed)];
}

/** Returns a lowercase ISO 639-1 language tag, or undefined when unresolvable. */
export function toIso639Language(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(trimmed)) return trimmed.toLowerCase();
  return LANGUAGE_NAME_TO_ISO639[normalizeKey(trimmed)];
}

/**
 * Parses GDELT's `seendate` (`YYYYMMDDTHHMMSSZ`) as well as ordinary ISO-8601
 * timestamps, returning an ISO string. Returns undefined for anything else so
 * the validator can reject the article rather than store a bogus date.
 */
export function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(trimmed);
  const candidate = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : trimmed;
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " "
};

/** Strips markup and decodes the handful of entities publishers actually emit. */
export function cleanPublisherText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/&#(\d{2,6});/g, (_match, code: string) => {
      const point = Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/election|president|minister|senate|parliament|government|policy|diplomat|sanction/i, "POLITICS"],
  [/\bai\b|artificial intelligence|technolog|software|cyber|robot|semiconductor|\bchip\b|startup/i, "TECHNOLOGY"],
  [/health|hospital|medical|disease|virus|vaccine|outbreak|\bwho\b/i, "HEALTH"],
  [/climate|weather|storm|flood|wildfire|drought|emission|renewable|energy/i, "CLIMATE"],
  [/market|econom|business|bank|trade|inflation|tariff|finance|earnings/i, "BUSINESS"],
  [/science|space|nasa|research|study|discovery|telescope/i, "SCIENCE"],
  [/sport|football|soccer|basketball|cricket|tennis|olympic|championship|league/i, "SPORTS"]
];

/** Home's category taxonomy, kept aligned with the mobile client's filters. */
export const HOME_NEWS_CATEGORIES = [
  "WORLD",
  "POLITICS",
  "TECHNOLOGY",
  "HEALTH",
  "CLIMATE",
  "BUSINESS",
  "SCIENCE",
  "SPORTS",
  "GENERAL"
] as const;

export function categoryForHeadline(title: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule[0].test(title)) return rule[1];
  }
  return "WORLD";
}
