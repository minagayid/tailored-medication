import { normalizeName } from "./normalization.js";

function metadata(sourceVersion) {
  return { sourceVersion, retrievedAt: new Date().toISOString() };
}

export class HttpSourceAdapter {
  constructor({ source, fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
    this.source = source;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    if (typeof this.fetchImpl !== "function") throw new Error("a fetch implementation is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("timeoutMs must be between 1 and 120000");
  }

  async getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { headers: { accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error(`${this.source} request failed: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${this.source} request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class RxNavAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "rxnorm", ...options }); }
  async search(term) {
    const url = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(term)}&search=2`;
    const payload = await this.getJson(url);
    return (payload.idGroup?.rxnormId ?? []).map((rxcui) => ({
      type: "medication_product", source: this.source, sourceId: rxcui,
      name: term, normalizedName: normalizeName(term), fields: { rxcui }, confidence: 0.9,
      matchStatus: "proposed", ...metadata("rxnav-rxcui-v1")
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
      fields: { setId: spl.setid, publishedDate: spl.published_date }, confidence: 0.95,
      matchStatus: "proposed", ...metadata("dailymed-spls-v2")
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
      confidence: 0.95, matchStatus: "proposed", ...metadata("pubchem-pug-v1")
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
      confidence: 0.85, matchStatus: "proposed", ...metadata("chembl-molecule-search-v1")
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
    errors: results.flatMap((result, index) => result.status === "rejected" ? [{ source: adapters[index].source, message: String(result.reason?.message ?? result.reason) }] : [])
  };
}
