import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---- Fixtures: one SSR-style HTML string per sub-page --------------------
// The adapter parses with querySelectorAll over tables/headings plus a regex
// fallback, so these fixtures use plain tags (no framework class names).
const VAULT_ADDR = "0xF550c9C8A5A87F8013c5f5Dc09AcBFf06263b9b1";
const TOKEN_ADDR = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const UNKNOWN_ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const KNOWN_ADDR = "0xdead00000000000000000000000000000000beef";

const informationHtml = `<!doctype html><html><head><title>Example Protocol | Immunefi</title></head><body>
<main>
<h1>Example Protocol</h1>
<p><a href="https://example.fi?utm_source=immunefi#top">https://example.fi</a></p>
<h2>Maximum Bounty</h2><p>$250,000</p>
<h2>Live Since</h2><p>2024-01-15</p>
<h2>Last Updated</h2><p>2025-06-01T00:00:00Z</p>
<h2>Tags</h2><p>DeFi, Bridge</p>
<h2>Vault</h2>
<p>Funds available: $1,000,000</p>
<p>30d avg payout: $25,000</p>
<p>Assets in vault: 2</p>
<p>Vault address: ${VAULT_ADDR}</p>
<h3>Smart Contract</h3>
<h2>Rewards by Threat Level</h2>
<table><tr><th>Severity</th><th>Payout</th></tr>
<tr><td>Critical</td><td>Max: $250,000 Min: $10,000 Primacy of Impact</td></tr>
<tr><td>High</td><td>Max: $50,000 Min: $5,000</td></tr>
<tr><td>Medium</td><td>Flat: $5,000</td></tr>
</table>
<h3>Web &amp; App</h3>
<table><tr><th>Severity</th><th>Payout</th></tr>
<tr><td>Critical</td><td>Max: $25,000 Min: $5,000</td></tr>
<tr><td>Low</td><td>Flat: $1,000</td></tr>
</table>
<h2>Rewards Body</h2><p>Critical findings are paid according to impact, minimums apply.</p>
<h2>Program Overview</h2><p>Example Protocol secures cross-chain messaging. Researchers must follow the rules.</p>
<h2>Audits</h2>
<table><tr><th>Auditor</th><th>Link</th><th>Completed at</th></tr>
<tr><td>Example Audit Firm</td><td><a href="https://example.com/audit.pdf">audit.pdf</a></td><td>2024-12-01</td></tr>
</table>
<h2>Known Issues</h2>
<table><tr><th>Category</th><th>Description</th><th>Last Updated At</th></tr>
<tr><td>Medium</td><td><a href="https://immunefi.com/issues/1">Stale price feed on periphery</a></td><td>2025-01-02</td></tr>
</table>
<h2>KYC</h2><p>KYC required for payouts over $1,000. See details in the dashboard.</p>
<h2>Proof of Concept</h2><p>PoC required for all submissions.</p>
<h2>Responsible Publication</h2><p>Category: coordinated disclosure</p>
<h2>Prohibited Activities</h2><p>No social engineering, no mainnet spam.</p>
<h2>Feasibility Limitations</h2><p>Findings requiring admin keys are out of scope.</p>
</main></body></html>`;

const scopeHtml = `<!doctype html><html><head><title>Example Scope | Immunefi</title></head><body>
<main>
<h2>Assets in Scope</h2>
<h3>Smart Contract</h3>
<table><tr><th>Funds</th><th>Type</th><th>Target</th><th>Name</th><th>Added on</th></tr>
<tr><td>$500k</td><td>Contract</td><td><a href="https://etherscan.io/address/${TOKEN_ADDR}">0xF550...63b9</a></td><td>Registry (Ethereum Mainnet)</td><td>2024-02-01</td></tr>
<tr><td></td><td></td><td><a href="https://arbiscan.io/address/${UNKNOWN_ADDR}">0xC02a...cC2</a></td><td>Messenger (Arbitrum One)</td><td>2024-03-01</td></tr>
<tr><td>$500k</td><td>Contract</td><td><a href="https://etherscan.io/address/${TOKEN_ADDR}">0xF550...63b9</a></td><td>Registry (Ethereum Mainnet)</td><td>2024-02-01</td></tr>
</table>
<h2>Impacts in Scope</h2>
<h3>Impacts Body</h3><p>Only the impacts below qualify at the stated severity.</p>
<table><tr><th>Severity</th><th>Title</th></tr>
<tr><td>Critical</td><td>Direct theft of user funds</td></tr>
<tr><td>High</td><td>Temporary freezing of funds</td></tr>
</table>
<h2>Out of Scope</h2>
<p>Attacks on example.fi marketing site are out of scope.</p>
<p>Default exclusions apply to third-party front ends.</p>
</main></body></html>`;

const resourcesHtml = `<!doctype html><html><head><title>Example Resources | Immunefi</title></head><body>
<main>
<h2>Codebase</h2>
<table><tr><th>Title</th><th>Description</th><th>Link</th></tr>
<tr><td>Core contracts</td><td>Main repo snapshot</td><td><a href="https://github.com/example/core?token=must-not-export">contracts.zip</a></td></tr>
</table>
<h2>Documentation</h2>
<table><tr><th>Title</th><th>Description</th><th>Link</th></tr>
<tr><td>Docs</td><td>Integration docs</td><td><a href="https://docs.example.fi/guide?session=must-not-export">guide</a></td></tr>
</table>
<h2>Assets Body</h2><p>Deployment addresses are listed in the scope table above.</p>
</main></body></html>`;

// ---- Mock browser -------------------------------------------------------
let executeOptions;
let fetchCalls;
let fetchMode = "ok"; // "ok" | "scope-404"

const htmlResponse = (html) => ({
  status: 200,
  ok: true,
  async text() { return html; },
  async json() { throw new Error("not json"); },
});

globalThis.chrome = {
  scripting: {
    async executeScript(options) {
      executeOptions = options;
      fetchCalls = [];
      globalThis.location = {
        protocol: "https:",
        hostname: "immunefi.com",
        origin: "https://immunefi.com",
      };
      globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url, init });
        if (url.endsWith("/information/")) return htmlResponse(informationHtml);
        if (url.endsWith("/scope/")) {
          if (fetchMode === "scope-404") return { status: 404, ok: false };
          return htmlResponse(scopeHtml);
        }
        if (url.endsWith("/resources/")) return htmlResponse(resourcesHtml);
        return { status: 404, ok: false };
      };
      // Live tab shows the information page; the func must default to it.
      globalThis.document = null;
      globalThis.DOMParser = undefined;
      return [{ result: await options.func(...options.args) }];
    },
  },
};

const adapterSource = await readFile(new URL("../platforms/immunefi.js", import.meta.url), "utf8");
const adapterUrl = `data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`;
const { default: immunefi } = await import(adapterUrl);

// ---- 1. Route matching ---------------------------------------------------
const programUrl = "https://immunefi.com/bug-bounty/example-protocol/information/";
assert.equal(immunefi.id, "immunefi");
assert.equal(immunefi.label, "Immunefi");
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol"), true);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol/"), true);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol/information/"), true);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol/scope"), true);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol/resources/"), true);
assert.equal(immunefi.matches("https://www.immunefi.com/bug-bounty/example-protocol"), true);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol/"), true);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol?tab=scope"), true);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/"), false);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty"), false);
assert.equal(immunefi.matches("https://immunefi.com/bug-bounty/example-protocol/faq"), false);
assert.equal(immunefi.matches("https://bugs.immunefi.com/login"), false);
assert.equal(immunefi.matches("https://evil.example/bug-bounty/example-protocol"), false);
assert.equal(immunefi.matches("http://immunefi.com/bug-bounty/example-protocol"), false);

// ---- 2. Full-fidelity extraction ------------------------------------------
fetchMode = "ok";
const normalized = await immunefi.extract({ tabId: 42, url: programUrl });

assert.equal(executeOptions.world, "MAIN");
assert.deepEqual(executeOptions.args, ["example-protocol", "information"]);
assert.equal(typeof executeOptions.func, "function");
assert.ok(!/import\s|require\(/.test(executeOptions.func.toString()), "serialized func must be dependency-free");
assert.equal(normalized.platform, "immunefi");
assert.equal(normalized.program.name, "Example Protocol");
assert.equal(normalized.program.handle, "example-protocol");
assert.equal(normalized.program.url, "https://immunefi.com/bug-bounty/example-protocol/information/");
assert.equal(normalized.program.website, "https://example.fi");
assert.match(normalized.program.about, /cross-chain messaging/);

// Header/vault metadata: every documented field must be present.
assert.deepEqual(normalized.metadata.tags, ["DeFi", "Bridge"]);
assert.equal(normalized.metadata.maxBounty, "$250,000");
assert.equal(normalized.metadata.maxBountyAmount, 250000);
assert.equal(normalized.metadata.liveSince, "2024-01-15");
assert.equal(normalized.metadata.lastUpdated, "2025-06-01T00:00:00Z");
assert.equal(normalized.metadata.vault.fundsAvailable, "$1,000,000");
assert.equal(normalized.metadata.vault.average30d, "$25,000");
assert.equal(normalized.metadata.vault.assetsInVault, "2");
assert.equal(normalized.metadata.vault.address, VAULT_ADDR);
assert.equal(normalized.metadata.kycRequired, true);
assert.equal(normalized.metadata.pocRequired, true);
assert.equal(normalized.metadata.publicationCategory, "Category: coordinated disclosure");
assert.deepEqual(normalized.metadata.audits, [
  { auditor: "Example Audit Firm", completedAt: "2024-12-01" },
]);
assert.equal(normalized.metadata.totalAssets, 2);
assert.equal(normalized.metadata.totalImpacts, 2);

// Assets: human name as display, full 0x address from href, chain from
// Name suffix, deduped. Truncated-hash chrome never leaks into display.
assert.equal(normalized.inScope.length, 2);
assert.equal(normalized.inScope[0].asset, "Registry");
assert.equal(normalized.inScope[0].address, TOKEN_ADDR);
assert.equal(normalized.inScope[0].chain, "Ethereum Mainnet");
assert.equal(normalized.inScope[0].type, "Contract");
assert.equal(normalized.inScope[0].group, "Smart Contract");
assert.equal(normalized.inScope[1].chain, "Arbitrum One");
assert.equal(normalized.inScope[1].address, UNKNOWN_ADDR);

// Impacts: severity/title pairs with description fallback.
assert.equal(normalized.impacts.length, 2);
assert.deepEqual(normalized.impacts[0], {
  severity: "Critical",
  title: "Direct theft of user funds",
  description: "",
});
assert.equal(normalized.impacts[1].severity, "High");
assert.equal(normalized.guidelines.scopeDescription, "Only the impacts below qualify at the stated severity.");

// Rewards: per-track x severity rows with min/max/flat + primacy.
assert.equal(normalized.rewards.currency, "USD");
assert.match(normalized.rewards.description, /minimums apply/);
assert.equal(normalized.rewards.rows.length, 5);
const scCritical = normalized.rewards.rows.find((r) => r.name === "Smart Contract — Critical");
assert.equal(scCritical.amounts.critical, 250000);
assert.equal(scCritical.amounts.criticalMinimum, 10000);
assert.equal(scCritical.useRange, true);
assert.equal(scCritical.primacy, "Primacy of Impact");
const scMedium = normalized.rewards.rows.find((r) => r.name === "Smart Contract — Medium");
assert.equal(scMedium.amounts.medium, 5000);
assert.equal(scMedium.amounts.mediumMinimum, 5000);
assert.equal(scMedium.useRange, false);
const webLow = normalized.rewards.rows.find((r) => r.name === "Web & App — Low");
assert.equal(webLow.amounts.low, 1000);
assert.equal(normalized.rewards.minimumReward, 1000);
assert.equal(normalized.rewards.maximumReward, 250000);
assert.deepEqual(normalized.rewards.tiers, []);
assert.equal(normalized.rewards.poolTotal, null);

// Out-of-scope text lands in guidance (and as line-level entries).
assert.match(normalized.guidelines.outOfScopeDescription, /marketing site/);
assert.match(normalized.guidelines.outOfScopeDescription, /third-party front ends/);
assert.ok(normalized.outOfScope.length >= 2);

// PoC/KYC flags, publication, severity assessment wiring.
assert.equal(normalized.guidelines.testingRequirements.poc, true);
assert.equal(normalized.guidelines.testingRequirements.kyc, true);
assert.match(normalized.guidelines.policy, /PoC required/);
assert.match(normalized.guidelines.policy, /KYC required/);
assert.match(normalized.guidelines.severityAssessment, /admin keys/);
assert.deepEqual(normalized.guidelines.safeHarbor, { immunefi: null });
assert.equal(normalized.guidelines.faq, "");
assert.equal(normalized.codeScope, null);

// Known issues: dedupe fields only, no links/dates/identifiers.
assert.equal(normalized.knownIssuesAvailable, true);
assert.deepEqual(normalized.knownIssues, [
  { title: "Stale price feed on periphery", priority: "Medium", state: "", target: "" },
]);
assert.ok(normalized.notes.some((n) => /1 known issue.*duplicate/i.test(n)));

// Attachments: fileName from link label only, never token URLs.
assert.equal(normalized.attachments.length, 2);
assert.deepEqual(normalized.attachments[0], {
  section: "Codebase",
  fileName: "contracts.zip",
  fileSize: null,
  contentType: "",
});
assert.equal(normalized.attachments[1].fileName, "guide");
assert.equal(JSON.stringify(normalized).includes("must-not-export"), false);
assert.equal(JSON.stringify(normalized).includes("utm_source"), false);

// Provenance source block.
assert.deepEqual(normalized.capture.source, {
  method: "first-party-api",
  description: "Immunefi program pages (information, scope, resources)",
  endpoint: "https://immunefi.com/bug-bounty/example-protocol/information/",
});
assert.deepEqual(normalized.capture.platformUpdatedAt, { program: "2025-06-01T00:00:00.000Z" });

// Fetch contract: exactly 3 same-origin GETs, session allowed, never bugs.*.
assert.equal(fetchCalls.length, 3);
assert.ok(fetchCalls.some((c) => c.url === "https://immunefi.com/bug-bounty/example-protocol/information/"));
assert.ok(fetchCalls.some((c) => c.url === "https://immunefi.com/bug-bounty/example-protocol/scope/"));
assert.ok(fetchCalls.some((c) => c.url === "https://immunefi.com/bug-bounty/example-protocol/resources/"));
assert.ok(fetchCalls.every((c) => c.init.method === "GET"));
assert.ok(fetchCalls.every((c) => c.init.credentials === "include"));
assert.ok(fetchCalls.every((c) => !c.url.includes("bugs.immunefi.com")));

// ---- 3. Partial: scope 404 -> complete:false + note, rest intact --------
fetchMode = "scope-404";
const partial = await immunefi.extract({ tabId: 42, url: programUrl });
assert.equal(partial.capture.source.complete, false);
assert.ok(partial.notes.some((n) => /scope page could not be retrieved/i.test(n)));
assert.equal(partial.program.name, "Example Protocol", "information data must survive a scope 404");
assert.equal(partial.inScope.length, 0);
assert.equal(partial.attachments.length, 2, "resources data must survive a scope 404");
assert.ok(partial.rewards.rows.length > 0);
fetchMode = "ok";

// ---- 4. Bad route -----------------------------------------------------------
await assert.rejects(
  immunefi.extract({ tabId: 42, url: "https://immunefi.com/bug-bounty/" }),
  /Open an Immunefi bug bounty program page/,
);

// ---- 5. Exporters + provenance integration ------------------------------------
const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
};
const { toJSON, toMarkdown } = await load("../lib/exporters.js");
const { attachCapture, buildCapture, fingerprintScope } = await load("../lib/provenance.js");

assert.equal(JSON.stringify(JSON.parse(toJSON(normalized))), JSON.stringify(normalized));
const capture = await buildCapture(normalized, { sourceUrl: programUrl });
const withCapture = attachCapture(normalized, capture);
assert.equal(withCapture.capture.retrievedFrom, programUrl);
assert.equal(withCapture.capture.platformUpdatedAt.program, "2025-06-01T00:00:00.000Z");
assert.equal(withCapture.capture.platformUpdatedAt.latest, "2025-06-01T00:00:00.000Z");
assert.ok(withCapture.capture.fingerprint.overall, "fingerprint must exist");
assert.equal(withCapture.capture.fingerprint.coverage.complete, true);
assert.deepEqual(withCapture.capture.fingerprint.counts, { inScope: 2, outOfScope: 2 });

const markdown = toMarkdown(withCapture, { platformLabel: "Immunefi" });
assert.match(markdown, /# Example Protocol/);
assert.match(markdown, /## In Scope/);
assert.match(markdown, /## Out of Scope/);
assert.match(markdown, /## Impacts in Scope/);
assert.match(markdown, /## Known Issues/);
assert.match(markdown, /## Rewards/);
assert.match(markdown, /## Snapshot/);
assert.match(markdown, /Ethereum Mainnet/);
assert.match(markdown, new RegExp(TOKEN_ADDR.slice(0, 10)));
assert.match(markdown, /\| Critical \| Direct theft of user funds \|/);
assert.match(markdown, /\| Stale price feed on periphery \| Medium \|/);
const withoutSnapshot = toMarkdown(withCapture, { platformLabel: "Immunefi", snapshot: false });
assert.equal(withoutSnapshot.includes("## Snapshot"), false);
assert.match(withoutSnapshot, /## In Scope/);

// Fingerprint moves on new impact/asset, ignores volatile counters.
const fingerprintOf = async (scope) => (await fingerprintScope(scope)).overall;
const before = await fingerprintOf(normalized);
const withExtraImpact = structuredClone(normalized);
withExtraImpact.impacts.push({ severity: "Critical", title: "New impact", description: "" });
assert.notEqual(await fingerprintOf(withExtraImpact), before, "new impact must move fingerprint");
const withExtraAsset = structuredClone(normalized);
withExtraAsset.inScope.push({ asset: "0xdead...beef", address: KNOWN_ADDR, chain: "Ethereum Mainnet" });
assert.notEqual(await fingerprintOf(withExtraAsset), before, "new asset must move fingerprint");
const volatile = structuredClone(normalized);
volatile.metadata.totalAssets = 99999;
volatile.metadata.totalImpacts = 99999;
assert.equal(await fingerprintOf(volatile), before, "counters must not move the fingerprint");

console.log("Immunefi route, normalization, export, privacy, partial, and fingerprint tests passed.");
