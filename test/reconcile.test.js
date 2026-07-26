import test from "node:test";
import assert from "node:assert/strict";
import { reconcileMedication } from "../src/reconcile.js";
import { safetyGate } from "../src/safety.js";

const base = [
  { type: "medication_product", source: "rxnorm", sourceId: "1191", name: "Aspirin", normalizedName: "aspirin", fields: { rxcui: "1191" }, confidence: 0.9 },
  { type: "medication_product", source: "dailymed", sourceId: "set-a", name: "Aspirin", normalizedName: "aspirin", fields: { setId: "set-a" }, confidence: 0.95 },
  { type: "molecular_entity", source: "pubchem", sourceId: "CID:2244", name: "Aspirin", normalizedName: "aspirin", fields: { cid: 2244, inchiKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N", molecularFormula: "C9H8O4" }, confidence: 0.95 }
];

test("reconciles scoped clinical and molecular fields with provenance", () => {
  const record = reconcileMedication({ query: "ASPIRIN", candidates: base });
  assert.equal(record.status, "resolved");
  assert.equal(record.medicationProduct.rxcui, "1191");
  assert.equal(record.molecularEntity.cid, 2244);
  assert.equal(record.provenance.product.rxcui[0].source, "rxnorm");
});

test("does not silently merge conflicting molecular identities", () => {
  const conflicting = [...base, { type: "molecular_entity", source: "chembl", sourceId: "CHEMBL1", name: "Aspirin", normalizedName: "aspirin", fields: { inchiKey: "OTHER" }, confidence: 0.85 }];
  const record = reconcileMedication({ query: "Aspirin", candidates: conflicting });
  assert.equal(record.status, "needs_review");
  assert.ok(record.conflicts.some((item) => item.field === "inchiKey"));
});

test("safety gate blocks unreviewed or unresolved cases", () => {
  const record = reconcileMedication({ query: "Aspirin", candidates: base });
  const decision = safetyGate({ record, evidence: [{ id: "e1" }], clinicianReviewed: false });
  assert.equal(decision.allowed, false);
  assert.match(decision.blockers.join(" "), /clinician/i);
});
