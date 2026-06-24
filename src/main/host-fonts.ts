// Pure host-font leak detection. A windows-spoof profile cannot vary its font
// set per profile on the closed CloakBrowser binary, so user-installed fonts leak
// identically into every profile and become a shared linkage signal. This finds
// the detected families that are NOT part of the stock Windows baseline — i.e. the
// ones a real fingerprinter (limited to the measureText width-probe over a known
// dictionary) could use to link a user's profiles.

/** Case- and whitespace-insensitive key for comparing font family names. */
function normalize(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * detected − baseline, normalized for case/whitespace. Returns the original
 * spelling of each offender, de-duplicated, in first-seen order.
 */
export function findNonStandardFonts(detected: string[], baseline: string[]): string[] {
  const stock = new Set(baseline.map(normalize));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const family of detected) {
    const key = normalize(family);
    if (!key || stock.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(family.trim());
  }
  return out;
}
