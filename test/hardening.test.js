import test from "node:test";
import assert from "node:assert/strict";
import { reconcileMedication } from "../src/reconcile.js";
import { projectToKnowledgeGraph } from "../src/graph.js";
import { safetyGate } from "../src/safety.js";
import { RxNavAdapter, HttpSourceAdapter, collectCandidates } from "../src/sources.js";
import { loadCandidateSnapshot } from "../src/snapshots.js";

const product = {
  type: "medication_product", source: "rxnorm", sourceId: "1191", name: "Aspirin",
  fields: { rxcui: "1191" }, confidence: 0.9, sourceVersion: "rxnorm-test-v1", retrievedAt: "2026-08-03T00:00:00Z", matchStatus: "verified"
};
const molecule = {
  type: "molecular_entity", source: "pubchem", sourceId: "CID:2244", name: "Aspirin",
  fields: { cid: 2244, inchiKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N" }, confidence: 0.95, sourceVersion: "pubchem-test-v1", retrievedAt: "2026-08-03T00:00:00Z", matchStatus: "verified"
};
const completeEvidence = [{
  id: "e1", source: "cpic", version: "2026.1", retrievedAt: "2026-08-03T00:00:00Z", grade: "A", applicability: "adult"
}];

test("does not infer a molecule relationship from a shared name", () => {
  const record = reconcileMedication({ query: "Aspirin", candidates: [product, molecule] });
  const graph = projectToKnowledgeGraph(record);
  assert.equal(record.molecularEntity, null);
  assert.equal(graph.edges.length, 0);
  assert.match(record.reviewReasons.join(" "), /explicit/i);
});

test("uses an explicit relationship as the only product-to-molecule edge", () => {
  const relatedProduct = {
    ...product,
    relationships: [{ type: "has_molecular_entity", targetSource: "pubchem", targetSourceId: "CID:2244", evidenceId: "rxnorm-snapshot-1" }]
  };
  const record = reconcileMedication({ query: "Aspirin", candidates: [relatedProduct, molecule] });
  const graph = projectToKnowledgeGraph(record);
  assert.equal(record.molecularEntity.inchiKey, "BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].properties.evidenceId, "rxnorm-snapshot-1");
});

test("safety gate rejects evidence without version and applicability", () => {
  const decision = safetyGate({
    record: { status: "resolved", medicationProduct: { rxcui: "1191" }, conflicts: [] },
    evidence: [{ id: "e1" }],
    clinicianReviewed: true,
    pharmacistReviewed: true
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.blockers.join(" "), /version|applicability/i);
});

test("safety gate rejects a resolved record without a clinical product", () => {
  const decision = safetyGate({
    record: { status: "resolved", medicationProduct: null, molecularEntity: { inchiKey: "X" }, conflicts: [] },
    evidence: completeEvidence,
    clinicianReviewed: true,
    pharmacistReviewed: true
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.blockers.join(" "), /product/i);
});

test("safety gate requires strict boolean attestations", () => {
  const decision = safetyGate({
    record: { status: "resolved", medicationProduct: { rxcui: "1191" }, conflicts: [], errors: [], reviewReasons: [], relationships: [] },
    evidence: completeEvidence,
    clinicianReviewed: "false",
    pharmacistReviewed: true
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.blockers.join(" "), /clinician/i);
});

test("unknown intended use is rejected even with complete attestations", () => {
  const decision = safetyGate({
    record: { status: "resolved", medicationProduct: { rxcui: "1191" }, conflicts: [], errors: [], reviewReasons: [], relationships: [] },
    evidence: completeEvidence,
    clinicianReviewed: true,
    pharmacistReviewed: true,
    intendedUse: "autonomous_prescribing"
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.blockers.join(" "), /recognized/i);
});

test("disjoint product identities require an explicit crosswalk", () => {
  const secondProduct = { ...product, source: "dailymed", sourceId: "set-other", fields: { setId: "set-other" } };
  const record = reconcileMedication({ query: "Aspirin", candidates: [product, secondProduct] });
  assert.equal(record.status, "needs_review");
  assert.match(record.reviewReasons.join(" "), /crosswalk|relationship/i);
});

test("distinct explicitly linked molecules remain an ambiguous identity", () => {
  const relatedProduct = {
    ...product,
    relationships: [
      { type: "has_molecular_entity", targetSource: "pubchem", targetSourceId: "CID:2244", evidenceId: "e-pubchem" },
      { type: "has_molecular_entity", targetSource: "chembl", targetSourceId: "CHEMBL2", evidenceId: "e-chembl" }
    ]
  };
  const alternate = { ...molecule, source: "chembl", sourceId: "CHEMBL2", fields: { chemblId: "CHEMBL2" } };
  const record = reconcileMedication({ query: "Aspirin", candidates: [relatedProduct, molecule, alternate] });
  assert.equal(record.status, "needs_review");
  assert.match(record.reviewReasons.join(" "), /ambiguous|conflict/i);
});

test("empty queries return a review record instead of throwing", () => {
  const record = reconcileMedication({ query: "   ", candidates: [] });
  assert.equal(record.status, "needs_review");
  assert.match(record.reviewReasons.join(" "), /query/i);
});

test("live adapter candidates carry retrieval metadata", async () => {
  const adapter = new RxNavAdapter({
    fetchImpl: async () => ({ ok: true, json: async () => ({ idGroup: { rxnormId: ["1191"] } }) })
  });
  const [candidate] = await adapter.search("Aspirin");
  assert.equal(candidate.sourceVersion, "rxnav-rxcui-v1");
  assert.match(candidate.retrievedAt, /^20/);
});

test("HTTP source requests are bounded by a timeout", async () => {
  const adapter = new HttpSourceAdapter({
    source: "test",
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => await new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  await assert.rejects(() => adapter.getJson("http://127.0.0.1/never"), /timed out|aborted/i);
});

test("source errors are converted to stable strings", async () => {
  const result = await collectCandidates("Aspirin", [{ source: "broken", search: async () => { throw "offline"; } }]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.errors[0].message, "offline");
});

test("offline snapshots provide replayable candidates", async () => {
  const snapshot = await loadCandidateSnapshot(new URL("../fixtures/aspirin.json", import.meta.url));
  assert.equal(snapshot.candidates[0].source, "rxnorm");
  assert.equal(snapshot.errors.length, 0);
});

test("verified candidates require source version and retrieval time", () => {
  const record = reconcileMedication({
    query: "Aspirin",
    candidates: [{ ...product, sourceVersion: undefined }]
  });
  assert.equal(record.status, "needs_review");
  assert.match(record.reviewReasons.join(" "), /sourceVersion|retrievedAt|metadata/i);
});
