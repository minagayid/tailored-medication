# Medication and molecular-data reconciliation

## Source roles

| Source | Authoritative use in this platform | Identifier / access note |
|---|---|---|
| RxNorm / RxNav | normalized clinical drug concepts, ingredient relations | RxCUI; public API |
| DailyMed | FDA labeling, dosage form, package and structured product labels | SET ID / NDC; public API |
| PubChem | chemical structure, InChIKey, formula, molecular weight | CID; public PUG REST |
| ChEMBL | curated bioactivity and molecule cross-references | ChEMBL ID; public API |
| DrugBank | licensed pharmacology and interaction enrichment | license-controlled ingestion only |
| CPIC / DPWG | pharmacogenomic guidance | guideline version and recommendation grade |

Do not treat one source as globally authoritative. Authority is **field-specific**: DailyMed for a label statement, RxNorm for a normalized clinical concept, PubChem for public chemical identifiers, ChEMBL for bioactivity context, and licensed DrugBank data only within its allowed terms.

## Reconciliation algorithm

1. Preserve raw source payload and retrieval time outside the canonical record.
2. Normalize human-readable names (case, punctuation, whitespace) without discarding the raw label.
3. Resolve clinical products and ingredients via explicit RxNorm relationships where available.
4. Resolve chemical entities by InChIKey first, then verified source identifiers; use names only to propose a match.
5. Merge fields only when scopes agree. For example, a molecular weight comes from chemical sources, while a package NDC comes from labeling sources.
6. Retain every claim as provenance. Contradicting values become `conflicts`, never silent overwrites.
7. Route ambiguous salt/base, stereoisomer, mixture, combination-product, strength, or API-error cases to human review.

## Source adapters

`src/sources.js` keeps external API formats at the edge and returns a small, source-neutral candidate shape. `src/reconcile.js` is deterministic and network-free; it can be replayed from stored source snapshots for auditability.

Example public endpoints used by adapters:

- RxNav: `https://rxnav.nlm.nih.gov/REST/rxcui.json?name={term}&search=2`
- DailyMed: `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name={term}`
- PubChem: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{term}/property/CanonicalSMILES,InChIKey,MolecularFormula,MolecularWeight/JSON`
- ChEMBL: `https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q={term}`

Production ingestion must obey each provider's terms, rate limits, attribution, caching requirements, and release/version policies.
