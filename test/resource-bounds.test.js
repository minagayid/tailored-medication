import test from "node:test";
import assert from "node:assert/strict";
import { DailyMedAdapter, RxNavAdapter } from "../src/sources.js";

test("live sources reject oversized responses and oversized terms", async () => {
  let calls = 0;
  const adapter = new RxNavAdapter({
    maxResponseBytes: 32,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ idGroup: { rxnormId: ["1191"] } }), { status: 200 });
    }
  });
  await assert.rejects(adapter.search("Aspirin"), /size limit/);
  await assert.rejects(adapter.search("x".repeat(201)), /1-200 characters/);
  assert.equal(calls, 1);
});

test("RxNorm limits candidate lookups and concurrency and verifies product names and TTY", async () => {
  const ids = Array.from({ length: 50 }, (_, index) => String(index + 1));
  let lookupCount = 0;
  let activeLookups = 0;
  let maximumConcurrentLookups = 0;
  const adapter = new RxNavAdapter({
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (!parsed.pathname.endsWith("/properties.json")) {
        return new Response(JSON.stringify({ idGroup: { rxnormId: ids } }), { status: 200 });
      }
      lookupCount += 1;
      activeLookups += 1;
      maximumConcurrentLookups = Math.max(maximumConcurrentLookups, activeLookups);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const isProduct = parsed.pathname.includes("/rxcui/1/");
      activeLookups -= 1;
      return new Response(JSON.stringify({
        properties: { name: isProduct ? "Aspirin" : "An ingredient", tty: isProduct ? "SCD" : "IN" }
      }), { status: 200 });
    }
  });
  const candidates = await adapter.search("Aspirin");
  assert.equal(lookupCount, 25);
  assert.ok(maximumConcurrentLookups <= 5);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, "Aspirin");
  assert.equal(candidates[0].fields.rxnormTermType, "SCD");
});

test("DailyMed caps source results and encodes the search term", async () => {
  let requestedUrl;
  const data = Array.from({ length: 80 }, (_, index) => ({ setid: "set-" + index, title: "Aspirin" }));
  const adapter = new DailyMedAdapter({
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
  });
  const candidates = await adapter.search("Aspirin + low dose");
  assert.equal(candidates.length, 50);
  assert.equal(requestedUrl.searchParams.get("drug_name"), "Aspirin + low dose");
});