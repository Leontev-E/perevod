'use strict';
// Country -> { name (RU), language (EN name used by the translator), currency, dial }.
// Prefills the form and feeds geoforms/phone. User can override every field.
const MAP = {
  // --- Европа ---
  AT: { name: 'Австрия', language: 'German', currency: 'EUR', dial: '+43' },
  AL: { name: 'Албания', language: 'Albanian', currency: 'ALL', dial: '+355' },
  BE: { name: 'Бельгия', language: 'French', currency: 'EUR', dial: '+32' },
  BG: { name: 'Болгария', language: 'Bulgarian', currency: 'BGN', dial: '+359' },
  BA: { name: 'Босния и Герцеговина', language: 'Bosnian', currency: 'BAM', dial: '+387' },
  GB: { name: 'Великобритания', language: 'English', currency: 'GBP', dial: '+44' },
  HU: { name: 'Венгрия', language: 'Hungarian', currency: 'HUF', dial: '+36' },
  DE: { name: 'Германия', language: 'German', currency: 'EUR', dial: '+49' },
  GR: { name: 'Греция', language: 'Greek', currency: 'EUR', dial: '+30' },
  DK: { name: 'Дания', language: 'Danish', currency: 'DKK', dial: '+45' },
  IE: { name: 'Ирландия', language: 'English', currency: 'EUR', dial: '+353' },
  ES: { name: 'Испания', language: 'Spanish', currency: 'EUR', dial: '+34' },
  IT: { name: 'Италия', language: 'Italian', currency: 'EUR', dial: '+39' },
  LV: { name: 'Латвия', language: 'Latvian', currency: 'EUR', dial: '+371' },
  LT: { name: 'Литва', language: 'Lithuanian', currency: 'EUR', dial: '+370' },
  MK: { name: 'Северная Македония', language: 'Macedonian', currency: 'MKD', dial: '+389' },
  MT: { name: 'Мальта', language: 'English', currency: 'EUR', dial: '+356' },
  MD: { name: 'Молдова', language: 'Romanian', currency: 'MDL', dial: '+373' },
  NL: { name: 'Нидерланды', language: 'Dutch', currency: 'EUR', dial: '+31' },
  NO: { name: 'Норвегия', language: 'Norwegian', currency: 'NOK', dial: '+47' },
  PL: { name: 'Польша', language: 'Polish', currency: 'PLN', dial: '+48' },
  PT: { name: 'Португалия', language: 'Portuguese', currency: 'EUR', dial: '+351' },
  RO: { name: 'Румыния', language: 'Romanian', currency: 'RON', dial: '+40' },
  RS: { name: 'Сербия', language: 'Serbian', currency: 'RSD', dial: '+381' },
  SK: { name: 'Словакия', language: 'Slovak', currency: 'EUR', dial: '+421' },
  SI: { name: 'Словения', language: 'Slovenian', currency: 'EUR', dial: '+386' },
  FI: { name: 'Финляндия', language: 'Finnish', currency: 'EUR', dial: '+358' },
  FR: { name: 'Франция', language: 'French', currency: 'EUR', dial: '+33' },
  HR: { name: 'Хорватия', language: 'Croatian', currency: 'EUR', dial: '+385' },
  ME: { name: 'Черногория', language: 'Montenegrin', currency: 'EUR', dial: '+382' },
  CZ: { name: 'Чехия', language: 'Czech', currency: 'CZK', dial: '+420' },
  CH: { name: 'Швейцария', language: 'German', currency: 'CHF', dial: '+41' },
  SE: { name: 'Швеция', language: 'Swedish', currency: 'SEK', dial: '+46' },
  EE: { name: 'Эстония', language: 'Estonian', currency: 'EUR', dial: '+372' },
  // --- СНГ / Кавказ / Центральная Азия ---
  RU: { name: 'Россия', language: 'Russian', currency: 'RUB', dial: '+7' },
  UA: { name: 'Украина', language: 'Ukrainian', currency: 'UAH', dial: '+380' },
  BY: { name: 'Беларусь', language: 'Russian', currency: 'BYN', dial: '+375' },
  KZ: { name: 'Казахстан', language: 'Russian', currency: 'KZT', dial: '+7' },
  UZ: { name: 'Узбекистан', language: 'Uzbek', currency: 'UZS', dial: '+998' },
  KG: { name: 'Киргизия', language: 'Russian', currency: 'KGS', dial: '+996' },
  TJ: { name: 'Таджикистан', language: 'Tajik', currency: 'TJS', dial: '+992' },
  TM: { name: 'Туркменистан', language: 'Russian', currency: 'TMT', dial: '+993' },
  AZ: { name: 'Азербайджан', language: 'Azerbaijani', currency: 'AZN', dial: '+994' },
  AM: { name: 'Армения', language: 'Armenian', currency: 'AMD', dial: '+374' },
  GE: { name: 'Грузия', language: 'Georgian', currency: 'GEL', dial: '+995' },
  // --- Ближний Восток / Африка ---
  TR: { name: 'Турция', language: 'Turkish', currency: 'TRY', dial: '+90' },
  IL: { name: 'Израиль', language: 'Hebrew', currency: 'ILS', dial: '+972' },
  SA: { name: 'Саудовская Аравия', language: 'Arabic', currency: 'SAR', dial: '+966' },
  AE: { name: 'ОАЭ', language: 'Arabic', currency: 'AED', dial: '+971' },
  QA: { name: 'Катар', language: 'Arabic', currency: 'QAR', dial: '+974' },
  KW: { name: 'Кувейт', language: 'Arabic', currency: 'KWD', dial: '+965' },
  BH: { name: 'Бахрейн', language: 'Arabic', currency: 'BHD', dial: '+973' },
  OM: { name: 'Оман', language: 'Arabic', currency: 'OMR', dial: '+968' },
  JO: { name: 'Иордания', language: 'Arabic', currency: 'JOD', dial: '+962' },
  LB: { name: 'Ливан', language: 'Arabic', currency: 'LBP', dial: '+961' },
  EG: { name: 'Египет', language: 'Arabic', currency: 'EGP', dial: '+20' },
  MA: { name: 'Марокко', language: 'Arabic', currency: 'MAD', dial: '+212' },
  TN: { name: 'Тунис', language: 'Arabic', currency: 'TND', dial: '+216' },
  DZ: { name: 'Алжир', language: 'Arabic', currency: 'DZD', dial: '+213' },
  ZA: { name: 'ЮАР', language: 'English', currency: 'ZAR', dial: '+27' },
  NG: { name: 'Нигерия', language: 'English', currency: 'NGN', dial: '+234' },
  KE: { name: 'Кения', language: 'English', currency: 'KES', dial: '+254' },
  // --- Латинская Америка ---
  MX: { name: 'Мексика', language: 'Spanish', currency: 'MXN', dial: '+52' },
  BR: { name: 'Бразилия', language: 'Portuguese', currency: 'BRL', dial: '+55' },
  AR: { name: 'Аргентина', language: 'Spanish', currency: 'ARS', dial: '+54' },
  CO: { name: 'Колумбия', language: 'Spanish', currency: 'COP', dial: '+57' },
  CL: { name: 'Чили', language: 'Spanish', currency: 'CLP', dial: '+56' },
  PE: { name: 'Перу', language: 'Spanish', currency: 'PEN', dial: '+51' },
  EC: { name: 'Эквадор', language: 'Spanish', currency: 'USD', dial: '+593' },
  BO: { name: 'Боливия', language: 'Spanish', currency: 'BOB', dial: '+591' },
  PY: { name: 'Парагвай', language: 'Spanish', currency: 'PYG', dial: '+595' },
  UY: { name: 'Уругвай', language: 'Spanish', currency: 'UYU', dial: '+598' },
  VE: { name: 'Венесуэла', language: 'Spanish', currency: 'USD', dial: '+58' },
  GT: { name: 'Гватемала', language: 'Spanish', currency: 'GTQ', dial: '+502' },
  CR: { name: 'Коста-Рика', language: 'Spanish', currency: 'CRC', dial: '+506' },
  PA: { name: 'Панама', language: 'Spanish', currency: 'USD', dial: '+507' },
  DO: { name: 'Доминикана', language: 'Spanish', currency: 'DOP', dial: '+1' },
  // --- Азия / Океания ---
  TH: { name: 'Таиланд', language: 'Thai', currency: 'THB', dial: '+66' },
  VN: { name: 'Вьетнам', language: 'Vietnamese', currency: 'VND', dial: '+84' },
  ID: { name: 'Индонезия', language: 'Indonesian', currency: 'IDR', dial: '+62' },
  MY: { name: 'Малайзия', language: 'Malay', currency: 'MYR', dial: '+60' },
  PH: { name: 'Филиппины', language: 'Filipino', currency: 'PHP', dial: '+63' },
  IN: { name: 'Индия', language: 'Hindi', currency: 'INR', dial: '+91' },
  PK: { name: 'Пакистан', language: 'Urdu', currency: 'PKR', dial: '+92' },
  BD: { name: 'Бангладеш', language: 'Bengali', currency: 'BDT', dial: '+880' },
  LK: { name: 'Шри-Ланка', language: 'Sinhala', currency: 'LKR', dial: '+94' },
  NP: { name: 'Непал', language: 'Nepali', currency: 'NPR', dial: '+977' },
  KH: { name: 'Камбоджа', language: 'Khmer', currency: 'USD', dial: '+855' },
  MM: { name: 'Мьянма', language: 'Burmese', currency: 'MMK', dial: '+95' },
  KR: { name: 'Южная Корея', language: 'Korean', currency: 'KRW', dial: '+82' },
  JP: { name: 'Япония', language: 'Japanese', currency: 'JPY', dial: '+81' },
  TW: { name: 'Тайвань', language: 'Chinese (Traditional)', currency: 'TWD', dial: '+886' },
  HK: { name: 'Гонконг', language: 'Chinese (Traditional)', currency: 'HKD', dial: '+852' },
  SG: { name: 'Сингапур', language: 'English', currency: 'SGD', dial: '+65' },
  // --- Северная Америка ---
  US: { name: 'США', language: 'English', currency: 'USD', dial: '+1' },
  CA: { name: 'Канада', language: 'English', currency: 'CAD', dial: '+1' }
};

// Unique language list (for the language datalist in the form).
const LANGUAGES = [...new Set(Object.values(MAP).map(v => v.language))].sort();

// Language name -> ISO 639-1 code, for the <html lang> attribute (a source page
// often keeps a stale lang="id"/"en" after its text is localized).
const LANG_ISO = {
  'polish': 'pl', 'english': 'en', 'german': 'de', 'spanish': 'es', 'french': 'fr', 'italian': 'it',
  'portuguese': 'pt', 'dutch': 'nl', 'czech': 'cs', 'slovak': 'sk', 'hungarian': 'hu', 'romanian': 'ro',
  'bulgarian': 'bg', 'greek': 'el', 'croatian': 'hr', 'serbian': 'sr', 'slovenian': 'sl', 'slovene': 'sl',
  'finnish': 'fi', 'swedish': 'sv', 'norwegian': 'no', 'danish': 'da', 'lithuanian': 'lt', 'latvian': 'lv',
  'estonian': 'et', 'ukrainian': 'uk', 'russian': 'ru', 'turkish': 'tr', 'arabic': 'ar', 'hebrew': 'he',
  'japanese': 'ja', 'korean': 'ko', 'thai': 'th', 'vietnamese': 'vi', 'indonesian': 'id', 'malay': 'ms',
  'hindi': 'hi', 'chinese': 'zh', 'chinese (traditional)': 'zh-Hant', 'chinese (simplified)': 'zh-Hans',
  'filipino': 'tl', 'tagalog': 'tl', 'albanian': 'sq', 'macedonian': 'mk', 'bosnian': 'bs', 'georgian': 'ka',
  'azerbaijani': 'az', 'kazakh': 'kk', 'uzbek': 'uz', 'armenian': 'hy', 'persian': 'fa', 'farsi': 'fa'
};
function langCode(language) {
  const k = String(language || '').trim().toLowerCase();
  return LANG_ISO[k] || '';
}

function defaultsFor(cc) {
  const e = MAP[(cc || '').toUpperCase()];
  return e ? { language: e.language, currency: e.currency } : { language: '', currency: '' };
}
function dialCode(cc) { const e = MAP[(cc || '').toUpperCase()]; return e ? e.dial : ''; }

// Compose the target-language instruction, honoring an explicit writing system
// (e.g. Uzbek/Kazakh/Serbian in Cyrillic vs Latin). Accepts a params object or
// (language, script). Returns e.g. "Uzbek written in the Cyrillic script".
const SCRIPT_NAMES = { latin: 'Latin', latinica: 'Latin', 'латиница': 'Latin', cyrillic: 'Cyrillic', 'кириллица': 'Cyrillic', arabic: 'Arabic', 'арабская': 'Arabic', greek: 'Greek', devanagari: 'Devanagari' };
function langDirective(languageOrParams, script) {
  const language = (languageOrParams && typeof languageOrParams === 'object') ? languageOrParams.language : languageOrParams;
  const raw = (languageOrParams && typeof languageOrParams === 'object') ? languageOrParams.script : script;
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'auto' || s === 'default' || s === 'авто') return language;
  const nice = SCRIPT_NAMES[s] || String(raw).trim();
  // If the language name already names a script, don't double it.
  if (new RegExp(nice, 'i').test(String(language))) return language;
  return `${language} written in the ${nice} script (use ${nice} letters only)`;
}

module.exports = { defaultsFor, dialCode, langDirective, langCode, MAP, LANGUAGES, LANG_ISO };
