import { readFile } from "node:fs/promises";

export async function loadCandidateSnapshot(pathOrUrl) {
  const raw = await readFile(pathOrUrl, "utf8");
  const snapshot = JSON.parse(raw);
  if (!snapshot || snapshot.schemaVersion !== "1" || !Array.isArray(snapshot.candidates) || !Array.isArray(snapshot.errors)) {
    throw new Error("invalid candidate snapshot schema");
  }
  return snapshot;
}
