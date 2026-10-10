import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---- Mock DOM helpers -------------------------------------------------
const makeHeading = (text, tag = "H2") => ({ tagName: tag, textContent: text });
const makePara = (text) => ({ tagName: "P", innerText: text, textContent: text });
const makeCode = (text) => ({ tagName: "CODE", textContent: text });
const makeLink = (href) => ({
  tagName: "A",
  innerText: href,
  textContent: href,
  href,
  getAttribute(name) {
    return name === "href" ? href : null;
  },
});
const makeList = (items) => ({
  tagName: "UL",
  querySelectorAll(selector) {
    if (selector === "li") return items.map((text) => ({ innerText: text, textContent: text }));
    return [];
  },
});
const makeTable = (rows) => ({
  tagName: "TABLE",
  querySelectorAll(selector) {
    if (selector === "tr") {
      return rows.map((cells) => ({
        querySelectorAll(inner) {
          if (inner === "th, td") {
            return cells.map((text) => ({ innerText: text, textContent: text }));
          }
          return [];
        },
      }));
    }
    return [];
  },
});

const COMMIT = "f6d0fb41b7487f60ce64e011312a956e184e2a75";

function competitionNodes() {
  return [
    makeHeading("Revert v4lend Competition"),
    makePara("Total Prize Pool: $50,000 USDC. Only High and Medium severity findings will be rewarded."),
    makeHeading("Scope"),
    makePara(`Repository: https://github.com/revert-finance/v4lend Commit: ${COMMIT}`),
    makeList([
      "src/vault/V4Vault.sol — ERC4626 lending vault",
      "src/oracle/V4Oracle.sol — two-source oracle",
    ]),
    makePara("git clone https://github.com/revert-finance/v4lend.git forge build forge test"),
    makeCode("src/shared/Math.sol"),
    makeHeading("Mandatory POC Rule"),
    makePara("All Critical/High/Medium findings require a valid coded POC before the end of the competition."),
    makeHeading("Out of Scope"),
    makeList([
      "Tests, scripts, and documentation under test/, script/, and docs/",
      "MEV, gas griefing, and frontrunning.",
    ]),
  ];
}

function bountyNodes() {
  return [
    makeHeading("Uniswap Bounty"),
    makePara("Final Payout = Base Severity Reward × (0.60 × Impact Score + 0.25 × Likelihood Score)"),
    makeHeading("Smart Contract - Uniswap v4 Core"),
    makeTable([
      ["Critical Impact Examples (Maximum Reward: $15,500,000)"],
      ["Theft of Pooled Liquidity | Reentrancy drains pool | Affects TVL"],
    ]),
    makeHeading("Scope"),
    makeList([
      "`UniswapV3Factory` — core factory",
      "`NonfungiblePositionManager` — LP NFT management",
    ]),
    makeHeading("Specific Exclusions"),
    makeList([
      "Admin Key Compromise Assumptions",
      "Gas Optimization Suggestions",
    ]),
    makeLink("https://github.com/Uniswap/v4-core"),
  ];
}

// Multi-repo competition shape (Uniswap-v4 style): per-repo commit links,
// nSLOC file tables, and a Chains list.
function multiRepoNodes() {
  return [
    makeHeading("Uniswap v4 Competition"),
    makePara("Total Prize Pool: $2,350,000 Primary Prize Pool: $2,250,000"),
    makeHeading("Scope"),
    makePara("v4-core https://github.com/Uniswap/v4-core/commit/18b223cab19dc778d9d287a82d29fee3e99162b0 commit: 18b223c"),
    makeTable([
      ["Contract | nsloc"],
      ["PoolManager.sol | 385"],
      ["Hooks.sol | 342"],
    ]),
    makePara("v4-periphery https://github.com/Uniswap/v4-periphery/commit/151b28293733b9cd8a310babc15408fe1ba55c35"),
    makeHeading("Chains"),
    makeList(["ethereum mainnet", "arbitrum", "base"]),
    makeHeading("Out of Scope issues"),
    makeList(["Previous security reviews", "Malicious tokens can drain all pools"]),
  ];
}

// ---- Mock browser -------------------------------------------------------
let executeOptions;
let mockMode = "competition";

globalThis.chrome = {
  scripting: {
    async executeScript(options) {
      executeOptions = options;
      globalThis.location = {
        protocol: "https:",
        hostname: "cantina.xyz",
        origin: "https://cantina.xyz",
      };
      const nodes = mockMode === "competition" ? competitionNodes()
        : mockMode === "multirepo" ? multiRepoNodes()
          : bountyNodes();
      const h1 = { textContent: mockMode === "competition" ? "Revert Finance / Revert v4lend Competition" : "Uniswap Labs / Uniswap bounty" };
      globalThis.document = {
        querySelector(selector) {
          if (selector === "h1") return h1;
          return { querySelectorAll: () => nodes };
        },
        body: { innerText: "Live Started on 1 Oct 2026 $50,000 USDC" },
      };
      return [{ result: await options.func(...options.args) }];
    },
  },
};

const adapterSource = await readFile(new URL("../platforms/cantina.js", import.meta.url), "utf8");
const adapterUrl = `data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}`;
const { default: cantina } = await import(adapterUrl);

// ---- 1. Route matching ---------------------------------------------------
const competitionUrl = "https://cantina.xyz/competitions/e275368c-547d-4d91-a418-053ad31082a8";
const bountyUrl = "https://cantina.xyz/bounties/f9df94db-c7b1-434b-bb06-d1360abdd1be";
assert.equal(cantina.id, "cantina");
assert.equal(cantina.label, "Cantina");
assert.equal(cantina.matches(competitionUrl), true);
assert.equal(cantina.matches(bountyUrl), true);
assert.equal(cantina.matches("https://cantina.xyz/competitions/pectra"), true);
assert.equal(cantina.matches("https://www.cantina.xyz/bounties/f9df94db-c7b1-434b-bb06-d1360abdd1be"), true);
assert.equal(cantina.matches(`${bountyUrl}?tab=scope`), true);
// Code-review workspace shell for the same opportunities.
const codeUrl = "https://cantina.xyz/code/2acbecd1-3a5e-44fb-a324-a524c156d690/overview";
assert.equal(cantina.matches(codeUrl), true);
assert.equal(cantina.matches("https://cantina.xyz/code/f9df94db-c7b1-434b-bb06-d1360abdd1be/scope"), true);
assert.equal(cantina.matches("https://cantina.xyz/code/f9df94db-c7b1-434b-bb06-d1360abdd1be"), true);
assert.equal(cantina.matches("https://cantina.xyz/bounties"), false);
assert.equal(cantina.matches("https://cantina.xyz/code"), false);
assert.equal(cantina.matches("https://cantina.xyz/code/not-a-uuid/overview"), false);
assert.equal(cantina.matches("https://cantina.xyz/bounties/coinbase"), false);
assert.equal(cantina.matches("https://cantina.xyz/competitions"), false);
assert.equal(cantina.matches("https://cantina.xyz/opportunities"), false);
assert.equal(cantina.matches("https://cantina.xyz/portfolio/abc"), false);
assert.equal(cantina.matches("https://evil.example/bounties/f9df94db-c7b1-434b-bb06-d1360abdd1be"), false);
assert.equal(cantina.matches("http://cantina.xyz/bounties/f9df94db-c7b1-434b-bb06-d1360abdd1be"), false);

// ---- 2. Competition extraction -------------------------------------------
mockMode = "competition";
const competition = await cantina.extract({ tabId: 7, url: competitionUrl });
assert.equal(executeOptions.world, "MAIN");
assert.deepEqual(executeOptions.args, ["competition", "e275368c-547d-4d91-a418-053ad31082a8", competitionUrl]);
assert.equal(competition.platform, "cantina");
assert.equal(competition.program.name, "Revert Finance / Revert v4lend Competition");
assert.equal(competition.program.url, competitionUrl);
assert.equal(competition.metadata.kind, "competition");
assert.equal(competition.metadata.state, "Live");
assert.equal(competition.metadata.poolTotal, 50000);
assert.equal(competition.metadata.poolToken, "USDC");

// Frozen code scope: repo + full commit + files.
assert.equal(competition.codeScope.repo, "revert-finance/v4lend");
assert.equal(competition.codeScope.commit, COMMIT);
assert.ok(competition.codeScope.files.includes("src/vault/V4Vault.sol"));
assert.ok(competition.codeScope.files.includes("src/oracle/V4Oracle.sol"));
assert.ok(competition.codeScope.files.includes("src/shared/Math.sol"));
assert.match(competition.codeScope.build, /forge build/);

// In-scope entries carry repo + commit for fingerprinting.
assert.ok(competition.inScope.length >= 3);
assert.ok(competition.inScope.every((e) => e.repo === "revert-finance/v4lend"));
assert.ok(competition.inScope.every((e) => e.commit === COMMIT));

// Out-of-scope: exclusion bullets captured, no file pollution.
assert.match(competition.guidelines.outOfScopeDescription, /MEV/);
assert.match(competition.guidelines.policy, /coded POC/);

// Rewards: pool parsed from header.
assert.equal(competition.rewards.poolTotal, 50000);
assert.equal(competition.rewards.poolToken, "USDC");

// Provenance + privacy.
assert.deepEqual(competition.capture.source, {
  method: "rendered-page",
  description: "Cantina competition page (rendered)",
  endpoint: competitionUrl,
});
assert.deepEqual(competition.capture.platformUpdatedAt, {});
assert.deepEqual(competition.notes, []);
// Privacy: commit hashes are scope (hex, no 0x prefix); no wallet-style
// 0x-addresses should appear anywhere in this fixture.
assert.equal(JSON.stringify(competition).includes("0x"), false);

// ---- 3. Bounty extraction --------------------------------------------------
mockMode = "bounty";
const bounty = await cantina.extract({ tabId: 7, url: bountyUrl });
assert.deepEqual(executeOptions.args, ["bounty", "f9df94db-c7b1-434b-bb06-d1360abdd1be", bountyUrl]);

// /code/<uuid> shell: kind-agnostic match, content-resolved kind.
mockMode = "bounty";
const codeBounty = await cantina.extract({ tabId: 7, url: codeUrl });
assert.deepEqual(
  executeOptions.args,
  ["opportunity", "2acbecd1-3a5e-44fb-a324-a524c156d690", codeUrl],
);
assert.equal(codeBounty.metadata.kind, "bounty");
assert.equal(codeBounty.program.url, codeUrl);

mockMode = "competition";
const codeCompetition = await cantina.extract({
  tabId: 7,
  url: "https://cantina.xyz/code/e275368c-547d-4d91-a418-053ad31082a8/overview",
});
assert.equal(codeCompetition.metadata.kind, "competition");
assert.equal(
  codeCompetition.program.url,
  "https://cantina.xyz/code/e275368c-547d-4d91-a418-053ad31082a8/overview",
);
mockMode = "competition";
assert.equal(bounty.metadata.kind, "bounty");
assert.equal(bounty.program.url, bountyUrl);

// Severity caps become structured rows.
assert.ok(bounty.rewards.rows.length >= 1);
const crit = bounty.rewards.rows.find((r) => r.name === "Critical");
assert.equal(crit.amounts.critical, 15500000);
assert.equal(bounty.rewards.maximumReward, 15500000);

// Payout calculator formula captured.
assert.match(bounty.rewards.calculator, /Final Payout/);
assert.match(bounty.rewards.description, /Impact Score/);

// Exclusions captured, vanity-slug guard holds.
assert.match(bounty.guidelines.outOfScopeDescription, /Admin Key/);
assert.equal(bounty.codeScope.repo, "Uniswap/v4-core");
// Named contract scopes become scope references with sources.
assert.ok(bounty.inScope.some((e) => e.asset === "UniswapV3Factory"));
assert.ok(bounty.inScope.some((e) => e.asset === "NonfungiblePositionManager"));
assert.deepEqual(bounty.capture.source, {
  method: "rendered-page",
  description: "Cantina bounty page (rendered)",
  endpoint: bountyUrl,
});

// ---- 4. Multi-repo competition: all repos/commits/files/chains -------------
mockMode = "multirepo";
const multi = await cantina.extract({
  tabId: 7,
  url: "https://cantina.xyz/competitions/e2cf6906-ec8b-4c78-a585-74ac90615659",
});
assert.equal(multi.codeScope.repo, "Uniswap/v4-core");
assert.equal(multi.codeScope.commit, "18b223cab19dc778d9d287a82d29fee3e99162b0");
assert.ok(multi.codeScope.additionalRepos.includes("Uniswap/v4-periphery"));
assert.ok(multi.codeScope.additionalCommits.includes("151b28293733b9cd8a310babc15408fe1ba55c35"));
assert.ok(multi.codeScope.files.includes("PoolManager.sol"));
assert.ok(multi.codeScope.files.includes("Hooks.sol"));
assert.ok(multi.codeScope.chains.includes("ethereum mainnet"));
assert.ok(multi.codeScope.chains.includes("arbitrum"));
assert.match(multi.guidelines.outOfScopeDescription, /Malicious tokens/);
mockMode = "competition";

// ---- 5. Bad route ------------------------------------------------------------
await assert.rejects(
  cantina.extract({ tabId: 7, url: "https://cantina.xyz/bounties" }),
  /Open a Cantina bounty or competition page/,
);

// ---- 5. Exporters + fingerprint (no data loss) ---------------------------------
const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
};
const { toJSON, toMarkdown } = await load("../lib/exporters.js");
const { attachCapture, buildCapture, fingerprintScope } = await load("../lib/provenance.js");

mockMode = "competition";
const normalized = await cantina.extract({ tabId: 7, url: competitionUrl });
assert.equal(JSON.stringify(JSON.parse(toJSON(normalized))), JSON.stringify(normalized));
const capture = await buildCapture(normalized, { sourceUrl: competitionUrl });
const withCapture = attachCapture(normalized, capture);
assert.equal(withCapture.capture.retrievedFrom, competitionUrl);
assert.ok(withCapture.capture.fingerprint.overall);
assert.equal(withCapture.capture.fingerprint.coverage.complete, true);

const markdown = toMarkdown(withCapture, { platformLabel: "Cantina" });
assert.match(markdown, /## Code Scope/);
assert.match(markdown, /revert-finance\/v4lend/);
assert.match(markdown, new RegExp(COMMIT.slice(0, 12)));
assert.match(markdown, /## In Scope/);
assert.match(markdown, /V4Vault\.sol/);
const withoutSnapshot = toMarkdown(withCapture, { platformLabel: "Cantina", snapshot: false });
assert.equal(withoutSnapshot.includes("## Snapshot"), false);
assert.match(withoutSnapshot, /## Code Scope/);

// Fingerprint: commit change moves it; reordering doesn't.
const fingerprintOf = async (scope) => (await fingerprintScope(scope)).overall;
const before = await fingerprintOf(normalized);
const changedCommit = structuredClone(normalized);
changedCommit.codeScope.commit = "0000000000000000000000000000000000000000";
assert.notEqual(await fingerprintOf(changedCommit), before, "commit change must move fingerprint");
const reordered = structuredClone(normalized);
reordered.codeScope.files.reverse();
assert.equal(await fingerprintOf(reordered), before, "file order must not move fingerprint");
const newFile = structuredClone(normalized);
newFile.codeScope.files.push("src/vault/NewVault.sol");
assert.notEqual(await fingerprintOf(newFile), before, "new file must move fingerprint");

console.log("Cantina route, normalization, export, privacy, partial, and fingerprint tests passed.");
