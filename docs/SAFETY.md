# Safety, governance, and clinical boundaries

## Hard product boundaries

- The resolver identifies data; it does not select a drug, calculate a dose, diagnose a condition, or authorize manufacturing.
- Any therapeutic option must include evidence, uncertainty, patient applicability, source versions, and a clinician-review status.
- Pharmacogenomic logic must use an approved guideline version and account for phenotype, allele-calling quality, ancestry limitations, comedications, renal/hepatic function, and local labeling.
- Molecular generation is confined to research queues. It must not create prescriptions or executable manufacturing instructions.
- Manufacturing requires pharmacist authorization, validated master batch records, chain of custody, release testing, and applicable GMP/USP/regulatory controls.

## Minimum controls before handling patient data

- Explicit purpose/consent management and minimum-necessary access.
- Encryption in transit and at rest; separate keys, tenants, and clinical/research environments.
- Role-based access with clinician, pharmacist, laboratory, researcher, and auditor roles.
- Immutable audit events for data access, resolution, evidence update, override, and release decision.
- Model/evidence versioning, bias assessment, clinical validation, incident response, and jurisdiction-specific legal review.

The `safetyGate()` function demonstrates a deliberately conservative software boundary: unresolved identity conflicts, missing evidence, or a non-clinician review state block downstream use.
