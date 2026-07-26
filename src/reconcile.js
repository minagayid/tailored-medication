import { normalizeName, unique } from "./normalization.js";

const FIELD_AUTHORITY = {
  rxcui: ["rxnorm"], setId: ["dailymed"], publishedDate: ["dailymed"],
  cid: ["pubchem"], chemblId: ["chembl"], inchiKey: ["pubchem", "chembl"],
  canonicalSmiles: ["pubchem", "chembl"], molecularFormula: ["pubchem"], molecularWeight: ["pubchem"]
};

function claim(candidate, field, value) {
  return { source: candidate.source, sourceId: candidate.sourceId, field, value, confidence: candidate.confidence };
}

function reconcileFields(candidates) {
  const values = new Map();
  for (const candidate of candidates) {
    for (const [field, value] of Object.entries(candidate.fields ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      const claims = values.get(field) ?? [];
      claims.push(claim(candidate, field, value));
      values.set(field, claims);
    }
  }
  const fields = {};
  const conflicts = [];
  for (const [field, claims] of values) {
    const authoritative = claims.filter((item) => (FIELD_AUTHORITY[field] ?? []).includes(item.source));
    const ranked = (authoritative.length ? authoritative : claims).sort((a, b) => b.confidence - a.confidence);
    fields[field] = ranked[0].value;
    if (unique(claims.map((item) => String(item.value))).length > 1) conflicts.push({ field, selected: ranked[0], alternatives: claims.filter((item) => item !== ranked[0]) });
  }
  return { fields, conflicts, provenance: Object.fromEntries([...values]) };
}

export function reconcileMedication({ query, candidates, errors = [] }) {
  const productCandidates = candidates.filter((item) => item.type === "medication_product");
  const moleculeCandidates = candidates.filter((item) => item.type === "molecular_entity");
  const acceptedProducts = productCandidates.filter((item) => item.normalizedName === normalizeName(query));
  const acceptedMolecules = moleculeCandidates.filter((item) => item.normalizedName === normalizeName(query));
  const product = reconcileFields(acceptedProducts);
  const molecule = reconcileFields(acceptedMolecules);
  const conflicts = [...product.conflicts, ...molecule.conflicts];
  const reviewReasons = [];
  if (!acceptedProducts.length) reviewReasons.push("No exact normalized clinical-product match.");
  if (moleculeCandidates.length && !acceptedMolecules.length) reviewReasons.push("Chemical name differs from query; verify salt, stereoisomer, or synonym.");
  if (conflicts.length) reviewReasons.push("One or more source claims conflict.");
  if (errors.length) reviewReasons.push("One or more source adapters failed.");
  const identifiers = unique([...acceptedProducts, ...acceptedMolecules].map((item) => `${item.source}:${item.sourceId}`));
  return {
    schemaVersion: "0.1", query, status: reviewReasons.length ? "needs_review" : "resolved",
    medicationProduct: acceptedProducts.length ? { displayName: acceptedProducts[0].name, ...product.fields } : null,
    molecularEntity: acceptedMolecules.length ? { displayName: acceptedMolecules[0].name, ...molecule.fields } : null,
    identifiers, provenance: { product: product.provenance, molecular: molecule.provenance }, conflicts, errors, reviewReasons
  };
}
