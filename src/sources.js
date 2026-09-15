import { normalizeName } from "./normalization.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SEARCH_TERM_CHARS = 200;
const MAX_SOURCE_RESULTS = 50;
const MAX_RXNORM_RESULTS = 25;
const RXNORM_LOOKUP_CONCURRENCY = 5;

function metadata(sourceVersion) {
  return { sourceVersion, retrievedAt: new Date().toISOString() };
}

async function readBoundedJson(response, maxBytes) {
  const declaredLength = Number(response.headers?.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("source response exceeded the configured size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("source response had no readable body");
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("source response exceeded the configured size limit");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validateSearchTerm(term) {
  if (typeof term !== "string" || !term.trim() || term.trim().length > MAX_SEARCH_TERM_CHARS) {
    throw new TypeError("search term must contain 1-" + MAX_SEARCH_TERM_CHARS + " characters");
  }
  return term.trim();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export class HttpSourceAdapter {
  constructor({ source, fetchImpl = globalThis.fetch, timeoutMs = 10_000, maxResponseBytes = MAX_RESPONSE_BYTES }) {
    this.source = source;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    if (typeof this.fetchImpl !== "function") throw new Error("a fetch implementation is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new Error("timeoutMs must be between 1 and 120000");
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 64 * 1024 * 1024) {
      throw new Error("maxResponseBytes must be between 1 and 67108864");
    }
  }

  async getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(this.source + " request failed: " + response.status);
      return await readBoundedJson(response, this.maxResponseBytes);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(this.source + " request timed out after " + this.timeoutMs + "ms");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class RxNavAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "rxnorm", ...options }); }
  async search(term) {
    term = validateSearchTerm(term);
    const url = "https://rxnav.nlm.nih.gov/REST/rxcui.json?name=" + encodeURIComponent(term) + "&search=0";
    const payload = await this.getJson(url);
    const rxcuis = (Array.isArray(payload.idGroup?.rxnormId) ? payload.idGroup.rxnormId : [])
      .filter((rxcui) => typeof rxcui === "string" && /^\d{1,20}$/.test(rxcui))
      .slice(0, MAX_RXNORM_RESULTS);
    const candidates = await mapWithConcurrency(rxcuis, RXNORM_LOOKUP_CONCURRENCY, async (rxcui) => {
      const properties = await this.getJson(
        "https://rxnav.nlm.nih.gov/REST/rxcui/" + encodeURIComponent(rxcui) + "/properties.json"
      );
      const { name, tty } = properties.properties ?? {};
      if (typeof name !== "string" || !name.trim() || !["SCD", "SBD"].includes(tty)) return null;
      return {
        type: "medication_product",
        source: this.source,
        sourceId: rxcui,
        name: name.trim(),
        normalizedName: normalizeName(name),
        matchType: normalizeName(name) === normalizeName(term) ? "exact" : "review",
        fields: { rxcui, rxnormTermType: tty },
        confidence: 0.9,
        matchStatus: "proposed",
        ...metadata("rxnav-rxcui-v1")
      };
    });
    return candidates.filter(Boolean);
  }
}

export class DailyMedAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "dailymed", ...options }); }
  async search(term) {
    term = validateSearchTerm(term);
    const url = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=" + encodeURIComponent(term);
    const payload = await this.getJson(url);
    return (Array.isArray(payload.data) ? payload.data : [])
      .filter((spl) => spl && typeof spl.setid === "string" && typeof spl.title === "string" && spl.title.trim())
      .slice(0, MAX_SOURCE_RESULTS)
      .map((spl) => ({
        type: "medication_product",
        source: this.source,
        sourceId: spl.setid,
        name: spl.title.trim(),
        normalizedName: normalizeName(spl.title),
        matchType: normalizeName(spl.title) === normalizeName(term) ? "exact" : "review",
        fields: { setId: spl.setid, publishedDate: spl.published_date },
        confidence: 0.95,
        matchStatus: "proposed",
        ...metadata("dailymed-spls-v2")
      }));
  }
}

export class PubChemAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "pubchem", ...options }); }
  async search(term) {
    term = validateSearchTerm(term);
    const properties = "Title,CanonicalSMILES,IsomericSMILES,InChIKey,MolecularFormula,MolecularWeight";
    const url = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + encodeURIComponent(term) + "/property/" + properties + "/JSON";
    const payload = await this.getJson(url);
    return (Array.isArray(payload.PropertyTable?.Properties) ? payload.PropertyTable.Properties : [])
      .filter((compound) => compound && Number.isInteger(compound.CID) && typeof compound.Title === "string" && compound.Title.trim())
      .slice(0, MAX_SOURCE_RESULTS)
      .map((compound) => ({
        type: "molecular_entity",
        source: this.source,
        sourceId: "CID:" + compound.CID,
        name: compound.Title.trim(),
        normalizedName: normalizeName(compound.Title),
        matchType: normalizeName(compound.Title) === normalizeName(term) ? "exact" : "review",
        fields: {
          cid: compound.CID,
          inchiKey: compound.InChIKey,
          canonicalSmiles: compound.ConnectivitySMILES ?? compound.CanonicalSMILES,
          isomericSmiles: compound.SMILES ?? compound.IsomericSMILES,
          molecularFormula: compound.MolecularFormula,
          molecularWeight: compound.MolecularWeight
        },
        confidence: 0.95,
        matchStatus: "proposed",
        ...metadata("pubchem-pug-v1")
      }));
  }
}

export class ChEMBLAdapter extends HttpSourceAdapter {
  constructor(options = {}) { super({ source: "chembl", ...options }); }
  async search(term) {
    term = validateSearchTerm(term);
    const url = "https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=" + encodeURIComponent(term) + "&limit=" + MAX_SOURCE_RESULTS;
    const payload = await this.getJson(url);
    return (Array.isArray(payload.molecules) ? payload.molecules : [])
      .filter((molecule) => molecule && typeof molecule.molecule_chembl_id === "string")
      .slice(0, MAX_SOURCE_RESULTS)
      .map((molecule) => ({
        type: "molecular_entity",
        source: this.source,
        sourceId: molecule.molecule_chembl_id,
        name: molecule.pref_name ?? term,
        normalizedName: normalizeName(molecule.pref_name ?? term),
        matchType: normalizeName(molecule.pref_name ?? term) === normalizeName(term) ? "exact" : "review",
        fields: {
          chemblId: molecule.molecule_chembl_id,
          maxPhase: molecule.max_phase,
          moleculeType: molecule.molecule_type,
          inchiKey: molecule.molecule_structures?.standard_inchi_key,
          canonicalSmiles: molecule.molecule_structures?.canonical_smiles
        },
        confidence: 0.85,
        matchStatus: "proposed",
        ...metadata("chembl-molecule-search-v1")
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