// Persona-specific probe inputs.
//
// The old harness probed ONE hardcoded 20-family list on every run. On a macOS
// persona that list is mostly Windows families, so "13/20 available" said almost
// nothing and the resulting fontHash was not a meaningful fingerprint — it was a
// constant. Each persona now gets a dictionary that reflects what a real machine
// of that OS actually ships, plus a shared block of commonly user-installed
// families (the ones that genuinely differ between two humans' machines).

export type Persona = 'macos' | 'windows';

/** Stock families a default Windows 10/11 install exposes (curated subset). */
const WINDOWS_STOCK: string[] = [
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima',
  'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact',
  'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console',
  'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya',
  'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa',
  'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei',
  'Mongolian Baiti', 'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI',
  'Palatino Linotype', 'Segoe MDL2 Assets', 'Segoe Print', 'Segoe Script',
  'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol',
  'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman',
  'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
];

/** Stock families a default macOS install exposes (curated subset). */
const MACOS_STOCK: string[] = [
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Apple SD Gothic Neo',
  'AppleGothic', 'Arial', 'Arial Black', 'Arial Narrow', 'Avenir', 'Avenir Next',
  'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bradley Hand', 'Brush Script MT',
  'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Charter', 'Cochin',
  'Comic Sans MS', 'Copperplate', 'Courier', 'Courier New', 'Didot',
  'DIN Alternate', 'DIN Condensed', 'Futura', 'Geneva', 'Georgia', 'Gill Sans',
  'Helvetica', 'Helvetica Neue', 'Herculanum', 'Hoefler Text', 'Impact',
  'Lucida Grande', 'Luminari', 'Marker Felt', 'Menlo', 'Monaco', 'Noteworthy',
  'Optima', 'Palatino', 'Papyrus', 'Phosphate', 'Rockwell', 'Savoye LET',
  'SignPainter', 'Skia', 'Snell Roundhand', 'Times', 'Times New Roman',
  'Trattatello', 'Trebuchet MS', 'Verdana', 'Zapfino',
];

/**
 * Families a real user commonly installs by hand (dev fonts, Google Fonts,
 * Office). These are the high-entropy ones: if two profiles on one host both
 * report the same unusual set, that set links them.
 */
const COMMON_NON_STOCK: string[] = [
  'Cascadia Code', 'DejaVu Sans', 'Fira Code', 'Hack', 'IBM Plex Mono',
  'IBM Plex Sans', 'Inter', 'JetBrains Mono', 'Lato', 'Liberation Sans',
  'Montserrat', 'MesloLGS NF', 'Noto Sans', 'Nunito', 'Open Sans', 'Poppins',
  'Roboto', 'Roboto Mono', 'Source Code Pro', 'Source Sans Pro', 'Ubuntu',
  'Ubuntu Mono', 'Work Sans',
];

/**
 * Families that only exist on the OTHER platform. Probing these is how we
 * detect a persona/host contradiction: a "Windows" browser that cannot see a
 * single Windows-only font, but does see Mac-only ones, is rendering with the
 * host's font stack.
 */
const WINDOWS_ONLY_TELLS: string[] = [
  'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia',
  'Corbel', 'Marlett', 'MS Gothic', 'Segoe UI', 'Sylfaen',
];

const MACOS_ONLY_TELLS: string[] = [
  'Apple Chancery', 'Chalkduster', 'Helvetica Neue', 'Lucida Grande', 'Menlo',
  'Monaco', 'Skia', 'Zapfino', 'Geneva', 'Papyrus',
];

function dedupe(list: string[]): string[] {
  return [...new Set(list)].sort((a, b) => a.localeCompare(b));
}

/** The full availability dictionary probed for a persona. */
export function fontDictionary(persona: Persona): string[] {
  const stock = persona === 'macos' ? MACOS_STOCK : WINDOWS_STOCK;
  return dedupe([...stock, ...COMMON_NON_STOCK, ...WINDOWS_ONLY_TELLS, ...MACOS_ONLY_TELLS]);
}

/** Stock families for the persona — anything detected outside this set is
 *  either user-installed or a cross-platform tell. */
export function stockFonts(persona: Persona): string[] {
  return dedupe(persona === 'macos' ? MACOS_STOCK : WINDOWS_STOCK);
}

/** Families that should NOT exist if the render stack really is this persona. */
export function foreignTells(persona: Persona): string[] {
  return dedupe(persona === 'macos' ? WINDOWS_ONLY_TELLS : MACOS_ONLY_TELLS);
}

/** Families that SHOULD exist if the render stack really is this persona. */
export function nativeTells(persona: Persona): string[] {
  return dedupe(persona === 'macos' ? MACOS_ONLY_TELLS : WINDOWS_ONLY_TELLS);
}

export interface FontMetricSpec {
  family: string;
  size: number;
  text: string;
}

const METRIC_TEXTS = [
  'mmmmmmmmmmlliWWWWW__0123456789',
  'Cwm fjord bank glyphs vext quiz',
  'ffi fl ffl — “quotes” … 1234567890',
];

/**
 * Width/geometry probes. Unlike availability (one bit per family), these expose
 * the actual rasterisation metrics, which is what a serious fingerprinter reads.
 * Kept to a fixed, ordered set so two runs are comparable number-by-number.
 */
export function fontMetricSpecs(persona: Persona): FontMetricSpec[] {
  const families = [
    ...(persona === 'macos'
      ? ['Helvetica', 'Helvetica Neue', 'Menlo', 'Times', 'Geneva']
      : ['Segoe UI', 'Calibri', 'Consolas', 'Cambria', 'Tahoma']),
    // Cross-platform families present almost everywhere — comparable between personas.
    'Arial', 'Courier New', 'Georgia', 'Times New Roman', 'Verdana',
    // Generic families: resolve through the host's fontconfig/DirectWrite defaults.
    'monospace', 'sans-serif', 'serif', 'cursive', 'fantasy',
  ];
  const specs: FontMetricSpec[] = [];
  for (const family of families) {
    for (const size of [11, 16, 27]) {
      for (const text of METRIC_TEXTS) {
        specs.push({ family, size, text });
      }
    }
  }
  return specs;
}
