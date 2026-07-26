export function safetyGate({ record, evidence = [], clinicianReviewed = false, intendedUse = "clinical_decision_support" }) {
  const blockers = [];
  if (record.status !== "resolved") blockers.push("Medication identity is unresolved or has conflicts.");
  if (!evidence.length) blockers.push("No versioned evidence was supplied.");
  if (!clinicianReviewed) blockers.push("A licensed clinician has not reviewed the case.");
  if (intendedUse === "manufacturing") blockers.push("Manufacturing requires separate pharmacist, quality, and regulatory release controls.");
  if (intendedUse === "novel_molecule") blockers.push("Novel molecules are research hypotheses and cannot be used for treatment.");
  return { allowed: blockers.length === 0, blockers, requiredNextStep: blockers.length ? "Resolve blockers before downstream use." : "Create an auditable clinician decision-support bundle." };
}
