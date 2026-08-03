import { normalizeName, unique } from "./normalization.js";

const FIELD_AUTHORITY = {
  rxcui: ["rxnorm"], setId: ["dailymed"], publishedDate: ["dailymed"],
  cid: ["pubchem"], chemblId: ["chembl"], inchiKey: ["pubchem", "chembl"],
  canonicalSmiles: ["pubchem", "chembl"], molecularFormula: ["pubchem"], molecularWeight: ["pubchem"]
};

function claim(candidate, field, value) {
  return {
    source: candidate.source,
    sourceId: candidate.sourceId,
    sourceVersion: candidate.sourceVersion ?? "unspecified",
    retrievedAt: candidate.retrievedAt ?? "unspecified",
    field,
    value,
    confidence: candidate.confidence
  };
}

function normalizeCandidate(candidate, index) {
  if (!candidate || typeof candidate !== "object") throw new Error(`candidate ${index} is not an object`);
  const source = String(candidate.source ?? "").trim();
  const sourceId = String(candidate.sourceId ?? "").trim();
  const name = String(candidate.name ?? "").trim();
  const type = String(candidate.type ?? "").trim();
  const confidence = Number(candidate.confidence);
  const matchStatus = String(candidate.matchStatus ?? "proposed").trim();
  if (!source || !sourceId || !name || !type) throw new Error(`candidate ${index} is missing identity fields`);
  if (!["medication_product", "molecular_entity"].includes(type)) throw new Error(`candidate ${index} has an unsupported type`);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`candidate ${index} has invalid confidence`);
  if (!["proposed", "verified", "rejected"].includes(matchStatus)) throw new Error(`candidate ${index} has an unsupported matchStatus`);
  if (matchStatus === "verified" && (!String(candidate.sourceVersion ?? "").trim() || !String(candidate.retrievedAt ?? "").trim())) {
    throw new Error(`candidate ${index} marked verified requires sourceVersion and retrievedAt`);
  }
  if (candidate.fields !== undefined && (!candidate.fields || typeof candidate.fields !== "object" || Array.isArray(candidate.fields))) {
    throw new Error(`candidate ${index} has invalid fields`);
  }
  const relationships = candidate.relationships ?? [];
  if (!Array.isArray(relationships)) throw new Error(`candidate ${index} has invalid relationships`);
  for (const relationship of relationships) {
    const relationshipType = String(relationship?.type ?? "");
    if (!relationship || !["same_product", "has_molecular_entity", "has_ingredient"].includes(relationshipType) || !relationship.targetSource || !relationship.targetSourceId) {
      throw new Error(`candidate ${index} has an incomplete relationship`);
    }
    if (!String(relationship.evidenceId ?? "").trim()) throw new Error(`candidate ${index} relationship requires evidenceId`);
  }
  const normalized = normalizeName(name);
  if (candidate.normalizedName && normalizeName(candidate.normalizedName) !== normalized) {
    throw new Error(`candidate ${index} has inconsistent normalizedName`);
  }
  return {
    ...candidate,
    type,
    source,
    sourceId,
    name,
    normalizedName: normalized,
    fields: candidate.fields ?? {},
    confidence,
    matchStatus,
    relationships
  };
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
    const ranked = [...(authoritative.length ? authoritative : claims)].sort((a, b) =>
      b.confidence - a.confidence || a.source.localeCompare(b.source) || a.sourceId.localeCompare(b.sourceId));
    fields[field] = ranked[0].value;
    if (unique(claims.map((item) => String(item.value))).length > 1) {
      conflicts.push({ field, selected: ranked[0], alternatives: claims.filter((item) => item !== ranked[0]) });
    }
  }
  return { fields, conflicts, provenance: Object.fromEntries(values) };
}

function relationKey(source, sourceId) {
  return `${source}:${sourceId}`;
}

function reviewRecord(query, reason, errors = []) {
  return {
    schemaVersion: "0.2", query, status: "needs_review", medicationProduct: null, molecularEntity: null,
    identifiers: [], relationships: [], provenance: { product: {}, molecular: {} }, conflicts: [],
    errors, reviewReasons: [reason]
  };
}

export function reconcileMedication({ query, candidates, errors = [] }) {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) return reviewRecord(query, "Query must not be empty.", errors);
  if (!Array.isArray(candidates)) return reviewRecord(query, "Candidates must be an array.", errors);

  const candidateErrors = [];
  const normalizedCandidates = [];
  candidates.forEach((candidate, index) => {
    try {
      normalizedCandidates.push(normalizeCandidate(candidate, index));
    } catch (error) {
      candidateErrors.push({ source: "candidate", message: String(error.message ?? error) });
    }
  });

  const productCandidates = normalizedCandidates.filter((item) => item.type === "medication_product");
  const moleculeCandidates = normalizedCandidates.filter((item) => item.type === "molecular_entity");
  const exactProducts = productCandidates.filter((item) => item.normalizedName === normalizedQuery);
  const acceptedProducts = exactProducts.filter((item) => item.matchStatus === "verified");
  const productRelationships = acceptedProducts.flatMap((product) => product.relationships
    .filter((relation) => relation.type === "same_product")
    .map((relation) => ({
      type: relation.type,
      fromSource: product.source,
      fromSourceId: product.sourceId,
      targetSource: String(relation.targetSource),
      targetSourceId: String(relation.targetSourceId),
      evidenceId: relation.evidenceId ?? null
    })));
  const relationships = acceptedProducts.flatMap((product) => product.relationships
    .filter((relation) => ["has_molecular_entity", "has_ingredient"].includes(relation.type))
    .map((relation) => ({
      type: relation.type,
      fromSource: product.source,
      fromSourceId: product.sourceId,
      targetSource: String(relation.targetSource),
      targetSourceId: String(relation.targetSourceId),
      evidenceId: relation.evidenceId ?? null
    })));
  const moleculesByKey = new Map(moleculeCandidates
    .filter((item) => item.matchStatus === "verified")
    .map((item) => [relationKey(item.source, item.sourceId), item]));
  const acceptedMolecules = relationships
    .map((relation) => moleculesByKey.get(relationKey(relation.targetSource, relation.targetSourceId)))
    .filter(Boolean)
    .filter((candidate, index, all) => all.findIndex((item) => relationKey(item.source, item.sourceId) === relationKey(candidate.source, candidate.sourceId)) === index);
  const product = reconcileFields(acceptedProducts);
  const molecule = reconcileFields(acceptedMolecules);
  const conflicts = [...product.conflicts, ...molecule.conflicts];
  const reviewReasons = [];
  if (!acceptedProducts.length) reviewReasons.push(exactProducts.length ? "Exact product candidates are proposals pending verification." : "No exact normalized clinical-product match.");
  if (acceptedProducts.length > 1) {
    const anchor = acceptedProducts[0];
    const crosswalkComplete = acceptedProducts.slice(1).every((candidate) => productRelationships.some((relation) =>
      relation.type === "same_product" && ((relation.fromSource === anchor.source && relation.fromSourceId === anchor.sourceId && relation.targetSource === candidate.source && relation.targetSourceId === candidate.sourceId) ||
      (relation.fromSource === candidate.source && relation.fromSourceId === candidate.sourceId && relation.targetSource === anchor.source && relation.targetSourceId === anchor.sourceId))));
    if (!crosswalkComplete) reviewReasons.push("Product candidates require an explicit crosswalk relationship.");
  }
  if (moleculeCandidates.length && acceptedProducts.length && !relationships.length) reviewReasons.push("Molecular entities require an explicit product relationship.");
  if (relationships.length && acceptedMolecules.length !== new Set(relationships.map((relation) => relationKey(relation.targetSource, relation.targetSourceId))).size) reviewReasons.push("An explicit molecular relationship target was not found or is unverified.");
  const molecularIdentities = new Set(acceptedMolecules.map((candidate) => candidate.fields.inchiKey ?? relationKey(candidate.source, candidate.sourceId)));
  if (molecularIdentities.size > 1) reviewReasons.push("Explicit relationships point to an ambiguous molecular identity.");
  if (exactProducts.some((candidate) => candidate.matchStatus !== "verified") || moleculeCandidates.some((candidate) => candidate.matchStatus !== "verified")) reviewReasons.push("One or more source matches remain unverified proposals.");
  if (conflicts.length) reviewReasons.push("One or more source claims conflict.");
  if (errors.length) reviewReasons.push("One or more source adapters failed.");
  const allErrors = [...errors, ...candidateErrors];
  const identifiers = unique([...acceptedProducts, ...acceptedMolecules].map((item) => `${item.source}:${item.sourceId}`));
  return {
    schemaVersion: "0.2", query, status: reviewReasons.length ? "needs_review" : "resolved",
    medicationProduct: acceptedProducts.length ? { displayName: acceptedProducts[0].name, ...product.fields } : null,
    molecularEntity: acceptedMolecules.length ? { displayName: acceptedMolecules[0].name, ...molecule.fields } : null,
    identifiers,
    relationships: [...productRelationships, ...relationships],
    provenance: { product: product.provenance, molecular: molecule.provenance },
    conflicts,
    errors: allErrors,
    reviewReasons: unique([...reviewReasons, ...candidateErrors.map((item) => item.message)])
  };
}
