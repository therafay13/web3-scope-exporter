import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---- Mock DOM helpers -------------------------------------------------
const makeCell = (text, { header = false } = {}) => ({
  tagName: header ? "TH" : "TD",
  innerText: text,
  textContent: text,
  querySelectorAll(selector) {
    if (selector === "th, td") return [this];
    return [];
  },
});
const makeRow = (cells, { header = false } = {}) => ({
  querySelectorAll(selector) {
    if (selector === "tr") return [this];
    if (selector === "th, td") return cells;
    if (selector === "th") return header ? cells : [];
    return [];
  },
});
const makeTable = (headerTexts, bodyRows, { previous = null } = {}) => {
  const headerCells = headerTexts.map((t) => makeCell(t, { header: true }));
  const headRow = makeRow(headerCells, { header: true });
  const rows = bodyRows.map((row) => makeRow(row.map((text) => makeCell(text))));
  return {
    tagName: "TABLE",
    previousElementSibling: previous,
    querySelectorAll(selector) {
      if (selector === "tr") return [headRow, ...rows];
      return [];
    },
  };
};
const makeHeading = (text, tag = "H2") => ({ tagName: tag, textContent: text });
const makePara = (text) => ({ tagName: "P", innerText: text, textContent: text });
const makeDiv = (text) => ({ tagName: "DIV", innerText: text, textContent: text });
const makeList = (items) => ({
  tagName: "UL",
  querySelectorAll(selector) {
    if (selector === "li") return items.map((text) => ({ innerText: text, textContent: text }));
    return [];
  },
});

// ---- Fixtures ----------------------------------------------------------
const programFixture = {
  title: "Hyperbridge Protocol",
  logo: "https://example.com/logo.png",
  companyName: "Hyperbridge",
  companySlug: "hyperbridge",
  isTriaged: true,
  startDate: "2024-01-15T00:00:00Z",
  endDate: "2025-01-15T00:00:00Z",
  kycRequired: true,
  pocRequired: true,
  reputationRequired: true,
  minReputation: 1200,
  state: "published",
  status: "LIVE",
  maxReward: "$50,000",
  maxBounty: "50000.0",
  minBounty: "200.0",
  rewards: {
    critical_max: "50000.0",
    critical_min: "10000",
    high_max: "$9,999",
    high_min: "$5,000",
    medium_max: "4999",
    medium_min: "1000.0",
    low_max: 500,
    low_min: 200,
  },
  scopes: [
    {
      title: "Smart Contract",
      target: "https://github.com/hyperbridge/protocol",
      target_description: "Core bridge contracts.",
      criticality: "Critical",
      out_of_scope: false,
      position: 1,
      id: 101,
    },
    {
      title: "Bridge",
      target: "HTTPS://WWW.HYPERBRIDGE.PROTOCOL/app/",
      target_description: "Bridge web app.",
      criticality: "High",
      out_of_scope: false,
      position: 2,
      id: 102,
    },
    // Duplicate row for the same target (rendered tables repeat them).
    {
      title: "Bridge",
      target: "hyperbridge.protocol/app",
      target_description: "Bridge web app.",
      criticality: "High",
      out_of_scope: false,
      position: 3,
      id: 103,
    },
    {
      title: "Web",
      target: "https://status.hyperbridge.protocol",
      target_description: "Status page; do not test.",
      criticality: "Low",
      out_of_scope: true,
      position: 4,
      id: 104,
    },
  ],
  description: "Hyperbridge connects chains securely.",
  programRules: "Do not attack production users.",
  focusArea: "Bridge message passing is in focus.",
  disclosureGuidelines: "Disclose privately first.",
  eligibilityAndCoordinateDisclosure: "Researchers must verify identity.",
  sla: { first_response: "24h", resolution_time: "7d", time_to_reward: "14d", time_to_triage: "48h" },
  labels: {
    types: ["Smart Contract", "Web"],
    languages: ["Solidity"],
    platforms: ["EVM"],
    project_types: ["Bridge"],
  },
  totalRewards: 26,
  submittedReports: 140,
  submitUrl: "https://dashboard.hackenproof.com/submit?token=must-not-export",
  repoLink: "https://github.com/hyperbridge/protocol",
  isUnending: false,
  // Leaderboard PII that must never be exported.
  leaderboard: [{ nickname: "must-not-export", avatar: "https://example.com/a.png" }],
};

const nuxtPayload = { data: { page: { program: programFixture } } };
const nuxtHtml = `<html><head><script id="__NUXT_DATA__" type="application/json" data-nuxt-data="nuxt-app" data-ssr="true">${JSON.stringify(nuxtPayload)}</script></head><body></body></html>`;

// Rendered-DOM fallback brief: a Target|Type|Severity table, an out-of-scope
// table, a Contract|Address table, a rewards prose section, and a policy
// section — plus site chrome that must never leak into policy.
function renderedBriefNodes() {
  return [
    makeHeading("Targets"),
    makePara("Only test listed assets."),
    makeTable(
      ["Target", "Type", "Severity"],
      [
        ["https://bridge.example/ Copy Copied", "Bridge", "Critical"],
        ["bridge.example", "Smart Contract", "High"],
        ["https://api.example/contracts", "API", "Medium"],
      ],
    ),
    // Second target table under an out-of-scope SUBHEADING while the page
    // heading still reads "In Scope" (ADI-style): must land out-of-scope.
    makeHeading("In Scope", "H3"),
    makeHeading("Out of scope", "H4"),
    makeTable(
      ["Target", "Type", "Severity"],
      [
        ["https://deprecated.example/", "Smart Contract", "Critical"],
      ],
      { previous: makeHeading("Out of scope", "H4") },
    ),
    makeTable(
      ["Contract", "Address"],
      [
        ["Diamond Proxy", "0x0583Ef2B6416cb7B287406438B940E4d99680C5B"],
        ["NotAnAddress", "not-an-address"],
      ],
      { previous: makeHeading("Out of scope", "H4") },
    ),
    makeHeading("Rewards by Threat Level"),
    makePara("Critical findings are paid up to $50,000. High findings up to $10,000."),
    makeHeading("Program Rules"),
    makeList(["Do not attack production users.", "No social engineering."]),
    makeHeading("Out of Scope"),
    makeTable(
      ["Target", "Type", "Severity"],
      [
        ["https://status.example/", "Web", "Low"],
      ],
    ),
    // Site chrome: nav/footer marketing must never enter policy —
    // including the concatenated no-newline blobs live pages deliver.
    makeDiv("Products & Services Solutions Hackers Company Resources"),
    makeDiv("2026 © HackenProof, Inc. All rights reserved."),
    makeDiv("Bug BountyPay-for-results bounty programs for Web2 and Web3 teamsPenetration TestingVetted researchers test your app. Kick-off within 24 hoursVulnerability TriageValidated, prioritized reports without the AI-generated noise"),
    makeDiv("SUI Security Expansion ProgramSui Foundation program: audits and bounties for Sui projectsEthereum Security ProgramProgram: Bug bounty for ERC-4337 account abstraction, up to $250K"),
    makeDiv("CommunityJoin 82,000+ researchers to trade tips and bounty newsDocsGuides on programs, scope, rules, and payouts"),
    // Leaderboard PII must be skipped wholesale, never exported.
    makeHeading("Leaderboard"),
    makeDiv("Top hunter must-not-export"),
  ];
}

// ---- Mock browser -------------------------------------------------------
let executeOptions;
let fetchCalls;
let mockMode = "refetch"; // "refetch" | "rendered"

const textResponse = (html) => ({
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
        hostname: "hackenproof.com",
        origin: "https://hackenproof.com",
      };
      globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url, init });
        if (mockMode === "refetch") return textResponse(nuxtHtml);
        return { status: 404, ok: false };
      };
      const nodes = mockMode === "rendered" ? renderedBriefNodes() : [];
      globalThis.document = {
        querySelector(selector) {
          if (selector === "#__NUXT_DATA__") return null; // force the refetch path
          if (selector === "main") return { querySelectorAll: () => nodes };
          return null;
        },
      };
      return [{ result: await options.func(...options.args) }];
    },
  },
};

const adapterSource = await readFile(new URL("../platforms/hackenproof.js", import.meta.url), "utf8");
const adapterUrl = `data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`;
const { default: hackenproof } = await import(adapterUrl);

// ---- 1. Route matching ---------------------------------------------------
const programUrl = "https://hackenproof.com/programs/hyperbridge-protocol";
assert.equal(hackenproof.id, "hackenproof");
assert.equal(hackenproof.label, "HackenProof");
assert.equal(hackenproof.matches(programUrl), true);
assert.equal(hackenproof.matches("https://www.hackenproof.com/programs/hyperbridge-protocol"), true);
assert.equal(hackenproof.matches(`${programUrl}/`), true);
assert.equal(hackenproof.matches(`${programUrl}?tab=scope`), true);
assert.equal(hackenproof.matches("https://hackenproof.com/programs"), false);
assert.equal(hackenproof.matches("https://hackenproof.com/programs/"), false);
assert.equal(hackenproof.matches("https://hackenproof.com/companies/hackenproof"), false);
assert.equal(hackenproof.matches("https://dashboard.hackenproof.com/login"), false);
assert.equal(hackenproof.matches("https://dashboard.hackenproof.com/programs/hyperbridge-protocol"), false);
assert.equal(hackenproof.matches("https://evil.example/programs/hyperbridge-protocol"), false);
assert.equal(hackenproof.matches("http://hackenproof.com/programs/hyperbridge-protocol"), false);

// ---- 2. Embedded (refetch) extraction -------------------------------------
mockMode = "refetch";
const normalized = await hackenproof.extract({
  tabId: 42,
  url: programUrl,
});

assert.equal(executeOptions.world, "MAIN");
assert.deepEqual(executeOptions.args, ["hyperbridge-protocol"]);
assert.equal(normalized.platform, "hackenproof");
assert.equal(normalized.program.name, "Hyperbridge Protocol");
assert.equal(normalized.program.handle, "hyperbridge-protocol");
assert.equal(normalized.program.url, programUrl);
assert.equal(normalized.program.website, "https://github.com/hyperbridge/protocol");
assert.equal(normalized.program.about, "Hyperbridge");

// Metadata: every embedded program key must be present.
assert.equal(normalized.metadata.companyName, "Hyperbridge");
assert.equal(normalized.metadata.companySlug, "hyperbridge");
assert.equal(normalized.metadata.state, "published");
assert.equal(normalized.metadata.status, "LIVE");
assert.equal(normalized.metadata.startDate, "2024-01-15T00:00:00Z");
assert.equal(normalized.metadata.endDate, "2025-01-15T00:00:00Z");
assert.equal(normalized.metadata.isUnending, false);
assert.equal(normalized.metadata.kycRequired, true);
assert.equal(normalized.metadata.pocRequired, true);
assert.equal(normalized.metadata.reputationRequired, true);
assert.equal(normalized.metadata.minReputation, 1200);
assert.equal(normalized.metadata.maxReward, "$50,000");
assert.equal(normalized.metadata.maxBountyAmount, 50000);
assert.equal(normalized.metadata.minBountyAmount, 200);
assert.deepEqual(normalized.metadata.labels, {
  types: ["Smart Contract", "Web"],
  languages: ["Solidity"],
  platforms: ["EVM"],
  project_types: ["Bridge"],
});
assert.equal(normalized.metadata.totalRewards, 26);
assert.equal(normalized.metadata.submittedReports, 140);

// Policy: description + rules + focus + eligibility + disclosure.
assert.match(normalized.guidelines.policy, /Hyperbridge connects chains/);
assert.match(normalized.guidelines.policy, /Do not attack production users/);
assert.match(normalized.guidelines.policy, /Bridge message passing is in focus/);
assert.match(normalized.guidelines.policy, /verify identity/);
assert.match(normalized.guidelines.policy, /Disclose privately/);
assert.equal(normalized.guidelines.scopeDescription, "Bridge message passing is in focus.");
assert.match(normalized.guidelines.outOfScopeDescription, /status\.hyperbridge\.protocol/);
assert.equal(normalized.guidelines.disclosure, "Disclose privately first.");
assert.deepEqual(normalized.guidelines.testingRequirements, { poc: true, kyc: true, minReputation: 1200 });
assert.deepEqual(normalized.guidelines.safeHarbor, { hackenproof: null });

// Scope split: duplicates deduped by normalized target.
assert.equal(normalized.inScope.length, 2);
assert.equal(normalized.inScope[0].asset, "https://github.com/hyperbridge/protocol");
assert.equal(normalized.inScope[0].type, "Smart Contract");
assert.equal(normalized.inScope[0].maxSeverity, "Critical");
assert.equal(normalized.inScope[0].instruction, "Core bridge contracts.");
assert.equal(normalized.inScope[1].asset, "HTTPS://WWW.HYPERBRIDGE.PROTOCOL/app/");
assert.equal(normalized.inScope[1].type, "Bridge");
assert.equal(normalized.outOfScope.length, 1);
assert.equal(normalized.outOfScope[0].asset, "https://status.hyperbridge.protocol");
assert.equal(normalized.outOfScope[0].type, "Web");
assert.ok(normalized.inScope.every((e) => e.asset !== "https://status.hyperbridge.protocol"));

// Rewards: the embedded matrix becomes structured rows on severity slots.
assert.equal(normalized.rewards.currency, "USD");
assert.equal(normalized.rewards.rows.length, 4);
const critical = normalized.rewards.rows.find((r) => r.name === "Critical");
assert.equal(critical.amounts.critical, 50000);
assert.equal(critical.amounts.criticalMinimum, 10000);
assert.equal(critical.useRange, true);
const low = normalized.rewards.rows.find((r) => r.name === "Low");
assert.equal(low.amounts.low, 500);
assert.equal(low.amounts.lowMinimum, 200);
assert.equal(normalized.rewards.minimumReward, 200);
assert.equal(normalized.rewards.maximumReward, 50000);

// Impacts stay empty without explicit Severity+title pairs; known issues empty.
assert.deepEqual(normalized.impacts, []);
assert.deepEqual(normalized.knownIssues, []);

// Attachments: repoLink as metadata only.
assert.equal(normalized.attachments.length, 1);
assert.deepEqual(normalized.attachments[0], {
  section: "Repository",
  fileName: "protocol",
  fileSize: null,
  contentType: "",
});

// Provenance source block: refetch path uses first-party-api + canonical URL.
assert.deepEqual(normalized.capture.source, {
  method: "first-party-api",
  description: "HackenProof program page refetch (same-origin)",
  endpoint: programUrl,
});
assert.deepEqual(normalized.capture.platformUpdatedAt, { program: "2025-01-15T00:00:00Z" });

// Fetch contract: one same-origin GET for the program page, never dashboard.
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].url, programUrl);
assert.equal(fetchCalls[0].init.method, "GET");
assert.equal(fetchCalls[0].init.credentials, "include");
assert.ok(fetchCalls.every((c) => !c.url.includes("dashboard")));

// Privacy: leaderboard PII and submitUrl tokens must not leak.
assert.equal(JSON.stringify(normalized).includes("must-not-export"), false);

// ---- 3. Rendered-DOM fallback -> partial export ---------------------------
mockMode = "rendered";
const fallback = await hackenproof.extract({ tabId: 42, url: programUrl });

assert.equal(fallback.platform, "hackenproof");
assert.equal(fallback.capture.source.method, "rendered-page");
assert.equal(fallback.capture.source.endpoint, programUrl);
assert.equal(fallback.capture.source.complete, false);
assert.ok(fallback.notes.some((n) => /Partial export/i.test(n)));
// Duplicate "bridge.example" rows merge into one; out-of-scope split holds.
// Copy-button chrome is stripped; the subheading out-of-scope table and the
// Contract|Address table land out-of-scope with addresses fingerprinted.
assert.equal(fallback.inScope.length, 2);
assert.equal(fallback.inScope[0].asset, "https://bridge.example/");
assert.equal(fallback.inScope[0].type, "Bridge");
assert.equal(fallback.inScope[0].maxSeverity, "Critical");
assert.equal(fallback.outOfScope.length, 3);
assert.equal(fallback.outOfScope[0].asset, "https://deprecated.example/");
assert.equal(fallback.outOfScope[1].asset, "0x0583ef2b6416cb7b287406438b940e4d99680c5b");
assert.equal(fallback.outOfScope[1].address, "0x0583ef2b6416cb7b287406438b940e4d99680c5b");
assert.equal(fallback.outOfScope[1].chain, "Ethereum");
assert.equal(fallback.outOfScope[1].instruction, "Diamond Proxy");
assert.ok(fallback.outOfScope.every((e) => e.asset !== "NotAnAddress"));
// Site chrome never enters policy.
assert.equal(fallback.guidelines.policy.includes("Products & Services"), false);
assert.equal(fallback.guidelines.policy.includes("© HackenProof"), false);
assert.match(fallback.rewards.description, /\$50,000/);
assert.equal(fallback.rewards.currency, "USD");
assert.equal(fallback.rewards.rows.length, 0);
assert.match(fallback.guidelines.policy, /Only test listed assets/);
assert.equal(JSON.stringify(fallback).includes("must-not-export"), false);
mockMode = "refetch";

// ---- 4. Bad route ------------------------------------------------------------
await assert.rejects(
  hackenproof.extract({ tabId: 42, url: "https://hackenproof.com/programs" }),
  /Open a HackenProof program page/,
);

// ---- 5. Exporters + fingerprint integration (no data loss) ---------------------
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
assert.equal(withCapture.capture.platformUpdatedAt.program, "2025-01-15T00:00:00.000Z");
assert.equal(withCapture.capture.platformUpdatedAt.latest, "2025-01-15T00:00:00.000Z");
assert.ok(withCapture.capture.fingerprint.overall, "fingerprint must exist");
assert.equal(withCapture.capture.fingerprint.coverage.complete, true);
assert.deepEqual(withCapture.capture.fingerprint.counts, { inScope: 2, outOfScope: 1 });

const markdown = toMarkdown(withCapture, { platformLabel: "HackenProof" });
assert.match(markdown, /# Hyperbridge Protocol/);
assert.match(markdown, /## In Scope/);
assert.match(markdown, /## Out of Scope/);
assert.match(markdown, /## Rewards/);
assert.match(markdown, /## Snapshot/);
assert.match(markdown, /hyperbridge\.protocol/);
assert.match(markdown, /Critical/);
const withoutSnapshot = toMarkdown(withCapture, { platformLabel: "HackenProof", snapshot: false });
assert.equal(withoutSnapshot.includes("## Snapshot"), false);
assert.match(withoutSnapshot, /## In Scope/);

// Fingerprint must move on real changes and ignore volatile counters.
const fingerprintOf = async (scope) => (await fingerprintScope(scope)).overall;
const before = await fingerprintOf(normalized);
const withExtraAsset = structuredClone(normalized);
withExtraAsset.inScope.push({ asset: "new.example.com", type: "Web" });
assert.notEqual(await fingerprintOf(withExtraAsset), before, "new asset must move fingerprint");
const withPolicyChange = structuredClone(normalized);
withPolicyChange.guidelines.policy += " New rule.";
assert.notEqual(await fingerprintOf(withPolicyChange), before, "policy change must move fingerprint");
const withRewardChange = structuredClone(normalized);
withRewardChange.rewards.rows[0].amounts.critical = 999999;
assert.notEqual(await fingerprintOf(withRewardChange), before, "reward change must move fingerprint");
const volatile = structuredClone(normalized);
volatile.metadata.totalRewards = 99999;
volatile.metadata.submittedReports = 99999;
assert.equal(await fingerprintOf(volatile), before, "counters must not move the fingerprint");

console.log("HackenProof route, normalization, export, privacy, partial, and fingerprint tests passed.");
