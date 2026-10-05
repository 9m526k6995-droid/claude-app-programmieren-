// Alle Länder (ISO-3166-Codes) mit deutschem Namen und Flagge – für die Länderwahl im Konto.

const CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(
    " ",
  );

/** Diese Länder stehen oben in der Auswahl */
export const POPULAR = ["DE", "AT", "CH", "NL", "BE", "LU", "PL", "TR", "FR", "IT", "ES", "GB", "US"];

let names: Intl.DisplayNames | null = null;
try {
  names = new Intl.DisplayNames(["de"], { type: "region" });
} catch {
  names = null;
}

const FALLBACK: Record<string, string> = { DE: "Deutschland", AT: "Österreich", CH: "Schweiz", NL: "Niederlande", XK: "Kosovo" };

export function isCountry(code: string | null | undefined): code is string {
  return Boolean(code && /^[A-Z]{2}$/.test(code) && CODES.includes(code));
}

export function countryName(code: string): string {
  try {
    const n = names?.of(code);
    if (n && n !== code) return n;
  } catch {
    /* unbekannt */
  }
  return FALLBACK[code] ?? code;
}

/** "DE" → 🇩🇪 (aus zwei Regional-Indikator-Zeichen) */
export function flag(code: string | null | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Alle Länder, beliebte zuerst, dann alphabetisch nach deutschem Namen */
export function allCountries(): { code: string; name: string; flag: string }[] {
  const list = CODES.map((code) => ({ code, name: countryName(code), flag: flag(code) }));
  const pop = POPULAR.map((c) => list.find((x) => x.code === c)!).filter(Boolean);
  const rest = list.filter((x) => !POPULAR.includes(x.code)).sort((a, b) => a.name.localeCompare(b.name, "de"));
  return [...pop, ...rest];
}

/** Suche nach Name oder Code (ohne Umlaut-Sorgen) */
export function searchCountries(q: string): { code: string; name: string; flag: string }[] {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const n = norm(q.trim());
  const all = allCountries();
  if (!n) return all;
  return all.filter((c) => norm(c.name).includes(n) || c.code.toLowerCase() === n);
}

export const COUNTRY_COUNT = CODES.length;
