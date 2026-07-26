# Architecture

## Delivery roadmap

| Phase | Capability | Release boundary |
|---|---|---|
| 1 | Approved-medication selection support, PGx evidence, interactions, monitoring | clinician decision support only |
| 2 | Microbiome signals, digital-twin and individualized PK/PD research | prospective validation required |
| 3 | Candidate-formulation research and pharmacist-supervised compounding workflows | laboratory, GMP, and regulatory controls |
| 4 | Closed-loop learning and validated automated production | regulator-approved, quality-managed deployment |

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

Medication products are **not** molecules. A branded or clinical drug may contain one or more ingredients, strengths, dose forms, and packages. The resolver therefore creates:

1. `MedicationProduct` — clinical concept, brand/generic labels, dose form, strength, package/NDC, label source.
2. `Ingredient` — active moiety/ingredient, RxNorm identifiers, standardized name.
3. `MolecularEntity` — stereochemistry-aware chemical identifiers such as InChIKey, SMILES, formula, and molecular weight.
4. `EvidenceAssertion` — source/version/field/claim so a later update never overwrites provenance.

Link a product to an ingredient only on an explicit source relationship or a reviewed normalized match. Link an ingredient to a molecular entity by InChIKey when available; names alone are insufficient for salts, mixtures, biologics, stereoisomers, or combination products.

## Deployment target

- API: stateless service behind an identity-aware gateway; this repo supplies the resolver core.
- Transactional store: PostgreSQL for consented clinical metadata and immutable resolution runs.
- Graph: Neo4j or RDF store for biomedical relations and evidence traversal.
- Object store: encrypted VCF, imaging, and assay artifacts; references only in operational services.
- Workflow: Nextflow for genomics and Airflow for governed ingestion/refreshes.
- Observability: audit logs, data lineage, source freshness, model/evidence version, and clinical override reasons.

No protected health information belongs in logs, test fixtures, or public repositories.
