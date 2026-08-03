import { reconcileMedication } from "../src/reconcile.js";
import { projectToKnowledgeGraph } from "../src/graph.js";
import { safetyGate } from "../src/safety.js";
import { loadCandidateSnapshot } from "../src/snapshots.js";

const snapshotPath = process.argv[2] ?? new URL("../fixtures/aspirin.json", import.meta.url);

try {
  const snapshot = await loadCandidateSnapshot(snapshotPath);
  const record = reconcileMedication(snapshot);
  const graph = projectToKnowledgeGraph(record);
  const gate = safetyGate({
    record,
    evidence: snapshot.evidence ?? [],
    clinicianReviewed: snapshot.clinicianReviewed === true,
    pharmacistReviewed: snapshot.pharmacistReviewed === true,
    intendedUse: snapshot.intendedUse ?? "clinical_decision_support"
  });
  console.log(JSON.stringify({ record, graph, gate }, null, 2));
} catch (error) {
  console.error(`Unable to resolve candidate snapshot: ${String(error.message ?? error)}`);
  process.exitCode = 1;
}
