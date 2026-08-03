import test from "node:test";
import assert from "node:assert/strict";
import { reconcileMedication } from "../src/reconcile.js";
import { safetyGate } from "../src/safety.js";

const base = [
  { type: "medication_product", source: "rxnorm", sourceId: "1191", name: "Aspirin", normalizedName: "aspirin", fields: { rxcui: "1191" }, confidence: 0.9, sourceVersion: "rxnorm-test-v1", retrievedAt: "2026-08-03T00:00:00Z", matchStatus: "verified", relationships: [{ type: "same_product", targetSource: "dailymed", targetSourceId: "set-a", evidenceId: "crosswalk-1" }, { type: "has_molecular_entity", targetSource: "pubchem", targetSourceId: "CID:2244", evidenceId: "rxnorm-snapshot-1" }] },
  { type: "medication_product", source: "dailymed", sourceId: "set-a", name: "Aspirin", normalizedName: "aspirin", fields: { setId: "set-a" }, confidence: 0.95, sourceVersion: "dailymed-test-v1", retrievedAt: "2026-08-03T00:00:00Z", matchStatus: "verified" },
  { type: "molecular_entity", source: "pubchem", sourceId: "CID:2244", name: "Aspirin", normalizedName: "aspirin", fields: { cid: 2244, inchiKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N", molecularFormula: "C9H8O4" }, confidence: 0.95, sourceVersion: "pubchem-test-v1", retrievedAt: "2026-08-03T00:00:00Z", matchStatus: "verified" }
];

test("reconciles scoped clinical and molecular fields with provenance", () => {
  const record = reconcileMedication({ query: "ASPIRIN", candidates: base });
  assert.equal(record.status, "resolved");
  assert.equal(record.medicationProduct.rxcui, "1191");
  assert.equal(record.molecularEntity.cid, 2244);
  assert.equal(record.provenance.product.rxcui[0].source, "rxnorm");
});

test("does not silently merge conflicting molecular identities", () => {
  const conflicting = [
    { ...base[0], relationships: [...base[0].relationships, { type: "has_molecular_entity", targetSource: "chembl", targetSourceId: "CHEMBL1", evidenceId: "chembl-snapshot-1" }] },
    ...base.slice(1),
    { type: "molecular_entity", source: "chembl", sourceId: "CHEMBL1", name: "Aspirin", normalizedName: "aspirin", fields: { inchiKey: "OTHER" }, confidence: 0.85, sourceVersion: "chembl-test-v1", retrievedAt: "2026-08-03T00:00:00Z", matchStatus: "verified" }
  ];
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
