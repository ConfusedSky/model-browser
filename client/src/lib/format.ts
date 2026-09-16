const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Whole numbers from ten of a unit up: `1023 B`, `1.5 KB`, `12 MB`. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  // 1023.5+ would *display* as "1024" — promote those to the next unit too.
  while (value >= 1023.5 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const text =
    unit === 0
      ? String(value)
      : value >= 9.95
        ? String(Math.round(value))
        : value.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}

/** mtime (ms) → localized medium-date + short-time string. */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Three places, not two, for a measured reason (confidence-scores-on-tiles D4):
 * text-query cosines differ only in the third, so two places assert ties that
 * do not exist. `-0.000` is normalised — a minus surviving every displayed digit
 * is a rendering artefact — and values that hit that branch do occur.
 */
export function formatCosine(score: number): string {
  const text = score.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
}

/**
 * Two places, not three: a third would imply a precision the median/MAD estimate
 * behind z does not have. Negative values are ordinary, and the cosine's `-0.00`
 * normalisation is likelier here, since z is centred on zero by construction.
 */
export function formatZ(z: number): string {
  const text = z.toFixed(2);
  return text === "-0.00" ? "0.00" : text;
}
