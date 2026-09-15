const ALLOWED_INTENDED_USE = new Set(["clinical_decision_support", "research_review", "manufacturing", "novel_molecule"]);

function evidenceBlockers(evidence) {
  const blockers = [];
  if (!Array.isArray(evidence) || !evidence.length) return ["No versioned evidence was supplied."];
  evidence.forEach((item, index) => {
    for (const field of ["source", "version", "retrievedAt", "grade", "applicability"]) {
      if (!item || item[field] === undefined || item[field] === null || String(item[field]).trim() === "") {
        blockers.push("Evidence item " + (index + 1) + " is missing " + field + ".");
      }
    }
  });
  return blockers;
}

export function safetyGate({ record, evidence = [], clinicianReviewed = false, pharmacistReviewed = false, intendedUse = "clinical_decision_support" }) {
  const blockers = [];
  if (!record || typeof record !== "object") blockers.push("A canonical medication record is required.");
  if (record && (!Array.isArray(record.conflicts) || !Array.isArray(record.errors) || !Array.isArray(record.reviewReasons) || !Array.isArray(record.relationships))) blockers.push("The canonical record schema is incomplete.");
  if (record?.status !== "resolved") blockers.push("Medication identity is unresolved or has conflicts.");
  if (!record?.medicationProduct) blockers.push("A clinical medication product identity is required.");
  if (record?.conflicts?.length) blockers.push("The record contains unresolved source conflicts.");
  if (record?.errors?.length) blockers.push("The record contains source or candidate errors.");
  if (record?.reviewReasons?.length) blockers.push("The record still contains review reasons.");
  blockers.push(...evidenceBlockers(evidence));
  if (clinicianReviewed !== true) blockers.push("A licensed clinician has not reviewed the case.");
  if (intendedUse === "clinical_decision_support" && pharmacistReviewed !== true) blockers.push("A pharmacist has not verified the medication context.");
  if (!ALLOWED_INTENDED_USE.has(intendedUse)) blockers.push("The intended use is not recognized.");
  if (intendedUse === "manufacturing") blockers.push("Manufacturing requires separate pharmacist, quality, and regulatory release controls.");
  if (intendedUse === "novel_molecule") blockers.push("Novel molecules are research hypotheses and cannot be used for treatment.");
  return {
    allowed: false,
    localChecksPassed: blockers.length === 0,
    blockers,
    requiredNextStep: "A trusted service must authenticate reviewers, verify evidence provenance, and authorize any downstream clinical workflow."
  };
}