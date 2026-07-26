import { reconcileMedication } from "../src/reconcile.js";
import { projectToKnowledgeGraph } from "../src/graph.js";
import { safetyGate } from "../src/safety.js";

const candidates = [
  { type: "medication_product", source: "rxnorm", sourceId: "1191", name: "Aspirin", normalizedName: "aspirin", fields: { rxcui: "1191" }, confidence: 0.9 },
  { type: "medication_product", source: "dailymed", sourceId: "demo-set", name: "Aspirin", normalizedName: "aspirin", fields: { setId: "demo-set", publishedDate: "2026-01-01" }, confidence: 0.95 },
  { type: "molecular_entity", source: "pubchem", sourceId: "CID:2244", name: "Aspirin", normalizedName: "aspirin", fields: { cid: 2244, inchiKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N", molecularFormula: "C9H8O4", molecularWeight: 180.16 }, confidence: 0.95 }
];
const record = reconcileMedication({ query: "Aspirin", candidates });
console.log(JSON.stringify({ record, graph: projectToKnowledgeGraph(record), gate: safetyGate({ record, evidence: [{ source: "label", version: "demo" }], clinicianReviewed: false }) }, null, 2));
