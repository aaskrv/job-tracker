// Normalization helpers used by the importer.

// Applied after punctuation is turned into spaces, so "B.V." is "b v" and "Sp. z o.o." is "sp z o o"
const COMPANY_SUFFIXES = /\b(gmbh|ag|bv|b v|ltd|llc|inc|plc|sa|s a|sp z o o|oy|ab|as|srl|s r l|se|corp|corporation|co|group|holding|technologies|technology)\b/g;

export function normCompany(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

const TITLE_NOISE = /\b(m\/w\/d|m\/f\/d|f\/m\/d|w\/m\/d|all genders|remote|hybrid|onsite|on-site|relocation|visa|sponsorship|100%)\b/g;

export function normTitle(title) {
  if (!title) return null;
  return title
    .toLowerCase()
    .replace(TITLE_NOISE, ' ')
    .replace(/\bsr\.?\b/g, 'senior')
    .replace(/\bdev\b/g, 'developer')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim() || null;
}

const COUNTRY_ALIASES = {
  germany: 'DE', deutschland: 'DE', netherlands: 'NL', 'the netherlands': 'NL', holland: 'NL',
  france: 'FR', spain: 'ES', portugal: 'PT', poland: 'PL', 'czech republic': 'CZ', czechia: 'CZ',
  cyprus: 'CY', estonia: 'EE', lithuania: 'LT', latvia: 'LV', ireland: 'IE', sweden: 'SE',
  denmark: 'DK', finland: 'FI', belgium: 'BE', austria: 'AT', italy: 'IT', luxembourg: 'LU',
  greece: 'GR', romania: 'RO', bulgaria: 'BG', hungary: 'HU', croatia: 'HR', slovakia: 'SK',
  slovenia: 'SI', malta: 'MT', 'united arab emirates': 'AE', uae: 'AE', dubai: 'AE', 'abu dhabi': 'AE',
  'united kingdom': 'GB', uk: 'GB', switzerland: 'CH', 'united states': 'US', usa: 'US',
  kazakhstan: 'KZ', serbia: 'RS', georgia: 'GE', armenia: 'AM', turkey: 'TR',
  'european union': 'EU', europe: 'EU', emea: 'EMEA', worldwide: 'WW', global: 'WW', anywhere: 'WW',
};

export const EU_COUNTRIES = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);

export function normCountry(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_ALIASES[v.toLowerCase()] || v;
}

const REMOTE_TYPES = new Set(['remote', 'hybrid', 'onsite', 'unknown']);
export function normRemote(value) {
  if (!value) return 'unknown';
  const v = String(value).toLowerCase().replace(/[^a-z]/g, '');
  if (v === 'onsite' || v === 'office') return 'onsite';
  return REMOTE_TYPES.has(v) ? v : 'unknown';
}

export function normTriState(value) {
  if (value === true || value === 'yes') return 'yes';
  if (value === false || value === 'no') return 'no';
  return 'unknown';
}

export function normBool(value) {
  if (value === true || value === 'yes') return true;
  if (value === false || value === 'no') return false;
  return null;
}

const PERIOD_TO_MONTH = { month: 1, year: 1 / 12, hour: 168 };

/**
 * Converts a raw salary into estimated net USD per month and a fit verdict.
 * Unknown salary type is treated as gross (vacancies in the EU almost always quote gross).
 */
export function normalizeSalary(salary, country, cfg) {
  const empty = { min: null, max: null, currency: null, period: null, type: 'unknown', netMin: null, netMax: null, fit: 'unknown' };
  if (!salary || (salary.min == null && salary.max == null)) return empty;

  const currency = salary.currency ? String(salary.currency).toUpperCase() : null;
  const period = PERIOD_TO_MONTH[salary.period] ? salary.period : 'year';
  const type = ['gross', 'net'].includes(salary.type) ? salary.type : 'unknown';
  const min = salary.min != null ? Number(salary.min) : null;
  const max = salary.max != null ? Number(salary.max) : null;
  const result = { ...empty, min, max, currency, period, type };

  const fx = currency ? cfg.salary.fx_to_usd[currency] : undefined;
  if (!fx) return result; // cannot convert, keep raw values only

  const ratios = cfg.salary.net_ratio_by_country;
  const netRatio = type === 'net' ? 1 : (ratios[country] ?? ratios._default);
  const toNet = (v) => (v == null ? null : Math.round(v * PERIOD_TO_MONTH[period] * fx * netRatio));
  result.netMin = toNet(min);
  result.netMax = toNet(max);

  const threshold = cfg.salary.min_net_usd_month;
  const low = result.netMin ?? result.netMax;
  const high = result.netMax ?? result.netMin;
  if (low >= threshold) result.fit = 'yes';
  else if (high >= threshold * (1 - cfg.salary.maybe_margin)) result.fit = 'maybe';
  else result.fit = 'no';
  return result;
}
