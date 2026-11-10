// The 66 books in canonical order: display name, OSIS id, USFM code, extra aliases.
const TABLE = [
  ['Genesis', 'Gen', 'GEN', 'gn ge'],
  ['Exodus', 'Exod', 'EXO', 'ex exo'],
  ['Leviticus', 'Lev', 'LEV', 'lv le'],
  ['Numbers', 'Num', 'NUM', 'nm nu nb'],
  ['Deuteronomy', 'Deut', 'DEU', 'dt de deu'],
  ['Joshua', 'Josh', 'JOS', 'jos jsh'],
  ['Judges', 'Judg', 'JDG', 'jdg jg jdgs'],
  ['Ruth', 'Ruth', 'RUT', 'rth ru rut'],
  ['1 Samuel', '1Sam', '1SA', '1sa 1sm 1s'],
  ['2 Samuel', '2Sam', '2SA', '2sa 2sm 2s'],
  ['1 Kings', '1Kgs', '1KI', '1ki 1k 1kin'],
  ['2 Kings', '2Kgs', '2KI', '2ki 2k 2kin'],
  ['1 Chronicles', '1Chr', '1CH', '1ch 1chron'],
  ['2 Chronicles', '2Chr', '2CH', '2ch 2chron'],
  ['Ezra', 'Ezra', 'EZR', 'ezr'],
  ['Nehemiah', 'Neh', 'NEH', 'ne'],
  ['Esther', 'Esth', 'EST', 'est es'],
  ['Job', 'Job', 'JOB', 'jb'],
  ['Psalms', 'Ps', 'PSA', 'psalm psa pss psm pslm'],
  ['Proverbs', 'Prov', 'PRO', 'pro prv pr'],
  ['Ecclesiastes', 'Eccl', 'ECC', 'ecc ec qoh qoheleth'],
  ['Song of Solomon', 'Song', 'SNG', 'sng sos so songofsongs canticles cant'],
  ['Isaiah', 'Isa', 'ISA', 'is'],
  ['Jeremiah', 'Jer', 'JER', 'je jr'],
  ['Lamentations', 'Lam', 'LAM', 'la'],
  ['Ezekiel', 'Ezek', 'EZK', 'eze ezk'],
  ['Daniel', 'Dan', 'DAN', 'da dn'],
  ['Hosea', 'Hos', 'HOS', 'ho'],
  ['Joel', 'Joel', 'JOL', 'jol joe jl'],
  ['Amos', 'Amos', 'AMO', 'amo am'],
  ['Obadiah', 'Obad', 'OBA', 'oba ob'],
  ['Jonah', 'Jonah', 'JON', 'jon jnh'],
  ['Micah', 'Mic', 'MIC', 'mi'],
  ['Nahum', 'Nah', 'NAM', 'nam na'],
  ['Habakkuk', 'Hab', 'HAB', 'hb'],
  ['Zephaniah', 'Zeph', 'ZEP', 'zep zp'],
  ['Haggai', 'Hag', 'HAG', 'hg'],
  ['Zechariah', 'Zech', 'ZEC', 'zec zc'],
  ['Malachi', 'Mal', 'MAL', 'ml'],
  ['Matthew', 'Matt', 'MAT', 'mat mt'],
  ['Mark', 'Mark', 'MRK', 'mrk mk mr mar'],
  ['Luke', 'Luke', 'LUK', 'luk lk'],
  ['John', 'John', 'JHN', 'jhn jn joh'],
  ['Acts', 'Acts', 'ACT', 'act ac actsoftheapostles'],
  ['Romans', 'Rom', 'ROM', 'ro rm'],
  ['1 Corinthians', '1Cor', '1CO', '1co'],
  ['2 Corinthians', '2Cor', '2CO', '2co'],
  ['Galatians', 'Gal', 'GAL', 'ga'],
  ['Ephesians', 'Eph', 'EPH', 'ephes'],
  ['Philippians', 'Phil', 'PHP', 'php phl pp'],
  ['Colossians', 'Col', 'COL', 'co'],
  ['1 Thessalonians', '1Thess', '1TH', '1th 1thes'],
  ['2 Thessalonians', '2Thess', '2TH', '2th 2thes'],
  ['1 Timothy', '1Tim', '1TI', '1ti 1tm'],
  ['2 Timothy', '2Tim', '2TI', '2ti 2tm'],
  ['Titus', 'Titus', 'TIT', 'tit ti'],
  ['Philemon', 'Phlm', 'PHM', 'phm philem pm'],
  ['Hebrews', 'Heb', 'HEB', 'he'],
  ['James', 'Jas', 'JAS', 'jm jam'],
  ['1 Peter', '1Pet', '1PE', '1pe 1pt 1p'],
  ['2 Peter', '2Pet', '2PE', '2pe 2pt 2p'],
  ['1 John', '1John', '1JN', '1jn 1jo 1joh 1j'],
  ['2 John', '2John', '2JN', '2jn 2jo 2joh 2j'],
  ['3 John', '3John', '3JN', '3jn 3jo 3joh 3j'],
  ['Jude', 'Jude', 'JUD', 'jud jde jd'],
  ['Revelation', 'Rev', 'REV', 're rv apocalypse revelations revelationofjohn'],
];

export const BOOKS = TABLE.map(([name, osis, usfm], index) => ({ index, name, osis, usfm, nt: index >= 39 }));

// "II Samuel", "2nd Sam.", "Second Samuel" -> "2samuel"
export function normalizeBook(raw) {
  let s = String(raw).toLowerCase().trim();
  s = s.replace(/^(iii|3rd|third)\b\.?\s*/, '3').replace(/^(ii|2nd|second)\b\.?\s*/, '2').replace(/^(i|1st|first)\b\.?\s+/, '1');
  return s.replace(/[^a-z0-9]/g, '');
}

const EXACT = new Map();
TABLE.forEach(([name, osis, usfm, extra], index) => {
  for (const alias of [name, osis, usfm, ...extra.split(' ')]) {
    const key = normalizeBook(alias);
    if (key && !EXACT.has(key)) EXACT.set(key, index);
  }
});
const NAME_KEYS = TABLE.map(([name]) => normalizeBook(name));

// Returns the book index for a name, abbreviation or unambiguous prefix; -1 if unknown.
export function findBook(raw, allowPrefix = true) {
  const key = normalizeBook(raw);
  if (!key) return -1;
  if (EXACT.has(key)) return EXACT.get(key);
  if (!allowPrefix || key.length < 2) return -1;
  const hit = NAME_KEYS.findIndex((name) => name.startsWith(key));
  return hit;
}

// Parses "John 3:16-18", "jn 3 16", "1 cor 13", "Psalm 23". Returns {b, c, v1, v2} (1-based, v may be null) or null.
export function parseReference(input) {
  const m = String(input).trim().match(/^((?:[1-3]|i{1,3}|1st|2nd|3rd|first|second|third)?\s*[a-z][a-z .]*?)\.?\s*(\d+)?(?:\s*[:.,\s]\s*(\d+))?(?:\s*[-–—]\s*(\d+))?$/i);
  if (!m) return null;
  const b = findBook(m[1]);
  if (b < 0) return null;
  const c = m[2] ? parseInt(m[2], 10) : 1;
  const v1 = m[3] ? parseInt(m[3], 10) : null;
  const v2 = m[4] ? parseInt(m[4], 10) : v1;
  return { b, c, v1, v2: v2 !== null && v1 !== null && v2 < v1 ? v1 : v2 };
}

export function formatReference(b, c, v1, v2) {
  let ref = `${BOOKS[b].name} ${c}`;
  if (v1) ref += `:${v1}${v2 && v2 !== v1 ? `-${v2}` : ''}`;
  return ref;
}
