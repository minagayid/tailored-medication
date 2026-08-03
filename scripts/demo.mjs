import { reconcileMedication } from "../src/reconcile.js";
import { projectToKnowledgeGraph } from "../src/graph.js";
import { safetyGate } from "../src/safety.js";
import { loadCandidateSnapshot } from "../src/snapshots.js";

const snapshot = await loadCandidateSnapshot(new URL("../fixtures/aspirin.json", import.meta.url));
const record = reconcileMedication(snapshot);
const evidence = [{ source: "fixture-label", version: "fixture-v1", retrievedAt: snapshot.retrievedAt, grade: "demonstration", applicability: "non-clinical fixture" }];
console.log(JSON.stringify({ record, graph: projectToKnowledgeGraph(record), gate: safetyGate({ record, evidence, clinicianReviewed: false, pharmacistReviewed: false }) }, null, 2));
