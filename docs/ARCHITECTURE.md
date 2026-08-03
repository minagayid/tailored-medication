# Architecture

## Delivery roadmap

| Phase | Capability | Release boundary |
|---|---|---|
| 1 | Approved-medication identity reconciliation and evidence boundary | clinician decision support only |
| 2 | Pharmacogenomic guidance, interactions, monitoring, and stronger clinical contracts | prospective validation required |
| 3 | Microbiome signals, digital-twin and individualized PK/PD research | prospective validation required |
| 4 | Candidate-formulation research and pharmacist-supervised compounding workflows | laboratory, GMP, and regulatory controls |
| 5 | Closed-loop learning and validated automated production | regulator-approved, quality-managed deployment |

## Bounded contexts

| Context | Owns | Contract |
|---|---|---|
| Clinical ingestion | FHIR resources, consent, OMOP mapping | versioned FHIR events; minimum necessary data |
| Omics ingestion | variants, expression, microbiome summaries | VCF/GA4GH metadata and encrypted source objects |
| Medication resolution | product/ingredient identity and crosswalks | `CanonicalMedicationRecord` with provenance/conflicts |
| Evidence | CPIC/DPWG, label, literature, interaction evidence | evidence cards with version, grade, and applicability |
| Knowledge graph | typed biomedical relations | RDF/Neo4j projection with source evidence |
| Therapeutic reasoning | ranked, explainable options | clinician-review bundle, never an autonomous order |
| Manufacturing (future) | digital batch specification | only pharmacist-approved, validated formulations |
| Feedback | outcomes, adherence, labs, wearables | de-identified learning events and audit trail |

## Medication identity boundary

Medication products are **not** molecules. A branded or clinical drug may contain one or more ingredients, strengths, dose forms, and packages. The resolver therefore keeps these concepts separate:

1. `MedicationProduct` — clinical concept, brand/generic labels, dose form, strength, package/NDC, and label source.
2. `Ingredient` — active moiety or ingredient and its clinical identifiers.
3. `MolecularEntity` — stereochemistry-aware chemical identifiers such as InChIKey, SMILES, formula, and molecular weight.
4. `EvidenceAssertion` — source/version/field/claim so a later update never overwrites provenance.

The current resolver accepts a product candidate only after `matchStatus: "verified"`. Multiple product identities require an explicit `same_product` crosswalk. A product-to-molecule edge requires an explicit `has_molecular_entity` or `has_ingredient` relationship with an evidence identifier. Names are used to compare a query with candidates, never to create a product-to-molecule identity edge.

The emitted `CanonicalMedicationRecord` is schema version `0.2` and contains selected fields, identifiers, typed relationships, field-level provenance, conflicts, adapter/candidate errors, and review reasons. Any unresolved item remains `needs_review`.

## Current local runtime

The repository runs as a dependency-free Node.js library. `src/reconcile.js` is deterministic and network-free; `src/sources.js` contains opt-in HTTP adapters; `src/snapshots.js` validates replayable candidate fixtures; `src/graph.js` emits a small typed graph projection; and `src/safety.js` provides a deliberately conservative downstream gate. `scripts/demo.mjs` exercises the complete offline path.

## Future deployment target

- API: stateless service behind an identity-aware gateway; this repository supplies the resolver core.
- Transactional store: PostgreSQL for consented clinical metadata and immutable resolution runs.
- Graph: Neo4j or RDF store for biomedical relations and evidence traversal.
- Object store: encrypted VCF, imaging, and assay artifacts; references only in operational services.
- Workflow: Nextflow for genomics and Airflow for governed ingestion/refreshes.
- Observability: audit logs, data lineage, source freshness, model/evidence version, and clinical override reasons.

No protected health information belongs in logs, test fixtures, or public repositories.
