import { normalizeName } from "./normalization.js";

export class HttpSourceAdapter {
  constructor({ source, fetchImpl = fetch }) {
    this.source = source;
    this.fetchImpl = fetchImpl;
  }

  async getJson(url) {
    const response = await this.fetchImpl(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${this.source} request failed: ${response.status}`);
    return response.json();
  }
}

export class RxNavAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "rxnorm", ...options }); }
  async search(term) {
    const url = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(term)}&search=2`;
    const payload = await this.getJson(url);
    return (payload.idGroup?.rxnormId ?? []).map((rxcui) => ({
      type: "medication_product", source: this.source, sourceId: rxcui,
      name: term, normalizedName: normalizeName(term), fields: { rxcui }, confidence: 0.9
    }));
  }
}

export class DailyMedAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "dailymed", ...options }); }
  async search(term) {
    const url = `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(term)}`;
    const payload = await this.getJson(url);
    return (payload.data ?? []).map((spl) => ({
      type: "medication_product", source: this.source, sourceId: spl.setid,
      name: spl.title, normalizedName: normalizeName(spl.title),
      fields: { setId: spl.setid, publishedDate: spl.published_date }, confidence: 0.95
    }));
  }
}

export class PubChemAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "pubchem", ...options }); }
  async search(term) {
    const properties = "CanonicalSMILES,IsomericSMILES,InChIKey,MolecularFormula,MolecularWeight";
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(term)}/property/${properties}/JSON`;
    const payload = await this.getJson(url);
    return (payload.PropertyTable?.Properties ?? []).map((compound) => ({
      type: "molecular_entity", source: this.source, sourceId: `CID:${compound.CID}`,
      name: term, normalizedName: normalizeName(term),
      fields: { cid: compound.CID, inchiKey: compound.InChIKey, canonicalSmiles: compound.ConnectivitySMILES ?? compound.CanonicalSMILES, isomericSmiles: compound.SMILES ?? compound.IsomericSMILES, molecularFormula: compound.MolecularFormula, molecularWeight: compound.MolecularWeight },
      confidence: 0.95
    }));
  }
}

export class ChEMBLAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "chembl", ...options }); }
  async search(term) {
    const url = `https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=${encodeURIComponent(term)}`;
    const payload = await this.getJson(url);
    return (payload.molecules ?? []).map((molecule) => ({
      type: "molecular_entity", source: this.source, sourceId: molecule.molecule_chembl_id,
      name: molecule.pref_name ?? term, normalizedName: normalizeName(molecule.pref_name ?? term),
      fields: { chemblId: molecule.molecule_chembl_id, maxPhase: molecule.max_phase, moleculeType: molecule.molecule_type, inchiKey: molecule.molecule_structures?.standard_inchi_key, canonicalSmiles: molecule.molecule_structures?.canonical_smiles },
      confidence: 0.85
    }));
  }
}

export class DrugBankLicensedAdapter {
  constructor() { this.source = "drugbank"; }
  async search() {
    throw new Error("DrugBank requires a licensed, governed ingestion connector; no public API call is attempted.");
  }
}

export async function collectCandidates(term, adapters) {
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.search(term)));
  return {
    candidates: results.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    errors: results.flatMap((result, index) => result.status === "rejected" ? [{ source: adapters[index].source, message: result.reason.message }] : [])
  };
}
