export function projectToKnowledgeGraph(record) {
  const nodes = [];
  const edges = [];
  const productIdentifier = record.identifiers?.find((id) => id.startsWith("rxnorm:") || id.startsWith("dailymed:"));
  const moleculeIdentifier = record.identifiers?.find((id) => id.startsWith("pubchem:") || id.startsWith("chembl:"));
  const productId = record.medicationProduct && productIdentifier ? `medication:${productIdentifier}` : null;
  const moleculeId = record.molecularEntity
    ? `molecule:${record.molecularEntity.inchiKey ?? record.molecularEntity.cid ?? moleculeIdentifier ?? ""}`
    : null;
  if (record.medicationProduct && productId) nodes.push({ id: productId, labels: ["MedicationProduct"], properties: record.medicationProduct });
  if (record.molecularEntity && moleculeId) nodes.push({ id: moleculeId, labels: ["MolecularEntity"], properties: record.molecularEntity });

  for (const relationship of record.relationships ?? []) {
    if (!productId || !moleculeId || record.status !== "resolved" || relationship.type !== "has_molecular_entity" || !relationship.evidenceId) continue;
    const targetMatches = record.identifiers?.includes(`${relationship.targetSource}:${relationship.targetSourceId}`);
    if (targetMatches && !moleculeId.endsWith(":")) {
      edges.push({
        from: productId,
        type: "HAS_MOLECULAR_ENTITY",
        to: moleculeId,
        properties: { evidenceId: relationship.evidenceId, status: record.status, requiresReview: record.status !== "resolved" }
      });
    }
  }
  for (const [scope, fields] of Object.entries(record.provenance ?? {})) {
    for (const [field, claims] of Object.entries(fields)) {
      for (const item of claims) {
        const evidenceId = `evidence:${item.source}:${item.sourceId}:${item.sourceVersion ?? "unspecified"}:${field}`;
        nodes.push({ id: evidenceId, labels: ["EvidenceAssertion"], properties: { scope, ...item } });
      }
    }
  }
  return { nodes, edges };
}
