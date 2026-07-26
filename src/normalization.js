export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function sameNormalizedName(a, b) {
  return normalizeName(a) === normalizeName(b);
}
