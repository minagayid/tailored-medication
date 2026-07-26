export function projectToKnowledgeGraph(record) {
  const nodes = [];
  const edges = [];
  if (record.medicationProduct) {
    nodes.push({ id: `medication:${record.identifiers.find((id) => id.startsWith("rxnorm:")) ?? record.query}`, labels: ["MedicationProduct"], properties: record.medicationProduct });
  }
  if (record.molecularEntity) {
    nodes.push({ id: `molecule:${record.molecularEntity.inchiKey ?? record.molecularEntity.cid ?? record.query}`, labels: ["MolecularEntity"], properties: record.molecularEntity });
  }
  if (nodes.length === 2) edges.push({ from: nodes[0].id, type: "HAS_CHEMICAL_ENTITY", to: nodes[1].id, properties: { status: record.status, requiresReview: record.status !== "resolved" } });
  for (const [scope, fields] of Object.entries(record.provenance)) {
    for (const [field, claims] of Object.entries(fields)) {
      for (const item of claims) {
        const evidenceId = `evidence:${item.source}:${item.sourceId}:${field}`;
        nodes.push({ id: evidenceId, labels: ["EvidenceAssertion"], properties: { scope, ...item } });
      }
    }
  }
  return { nodes, edges };
}
