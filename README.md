# Web3 Scope Exporter

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)
![Dependency-free](https://img.shields.io/badge/dependencies-none-brightgreen.svg)

A dependency-free Chromium (MV3) extension that captures **every policy-relevant detail** of a Web3 bug bounty program — scope assets, severity language, rewards, rules, frozen code scope — and exports it as compact **Markdown** or normalized **JSON** with snapshot provenance and drift-detecting content fingerprints.

Built for security researchers who live across [Immunefi](https://immunefi.com), [HackenProof](https://hackenproof.com), and [Cantina](https://cantina.xyz): the difference between a valid submission and an invalid one is knowing exactly what is in scope, at which severity, under which rules — frozen at a point in time you can prove later.

## Why this exists

Web3 program scope is precise machine data: chains, contract addresses, repos pinned to commits, per-severity impact statements, tier ceilings, payout formulas. A stale copy is dangerous — a commit moves, a tier ceiling changes, an impact is reworded from High to Critical, and your submission is suddenly out of scope.

This extension gives you:

- **Complete captures** — assets with chain/address/repo/commit, Severity→Title impacts, reward rows with min/max, out-of-scope rules, PoC/KYC/disclosure requirements, audits, known issues, codebase/docs references.
- **Provenance** — every export records when it was taken, from which exact URL, via which method, plus the platform's own update timestamps.
- **Drift detection** — a SHA-256 content fingerprint (assets / policy / rewards / program-state) that moves only on policy-relevant change. Re-export and compare.
- **Privacy** — no telemetry, first-party origins only, no reporter PII, no tokens, no session material. Data leaves the popup only when you Copy or Save.

## Supported platforms

| Platform | Pages | What gets captured |
|---|---|---|
| **Immunefi** | `immunefi.com/bug-bounty/<slug>/{information,scope,resources}` | Vault box, per-track rewards with primacy tags, assets (full `0x` resolved from links, chain parsed), Severity/Title impacts, out-of-scope rules, audits, known issues, PoC/KYC/publication, codebase + docs |
| **HackenProof** | `hackenproof.com/programs/<slug>` | Embedded program data (targets with max severity, rewards matrix, rules, labels, KYC/PoC flags) with a rendered-page fallback; deployed `Contract\|Address` tables; detail-card context |
| **Cantina** | `cantina.xyz/{bounties,competitions}/<uuid>`, `/code/<uuid>` | Category scope blocks, per-group severity caps, payout-calculator formulas, frozen repo + commit + file lists, multi-repo + chains, prize pools and pot splits, timelines, full rules; doc-linked bounties resolve to named scope references |

## Install (load unpacked)

> Browser extensions can read pages where they run. Review the source and the permissions below before installing — especially in a profile used for authenticated research.

1. Clone: `git clone https://github.com/CanuteTheWise/web3-scope-exporter`
2. Open `chrome://extensions/` (or `brave://extensions/`), enable **Developer mode**.
3. **Load unpacked** → select the `web3-scope-exporter/` directory.
4. Open a supported program page → click the toolbar icon. A `!` badge marks supported pages.

## Use

1. Visit a supported bug bounty page.
2. Open the extension — extraction starts automatically.
3. Pick **Markdown** or **JSON**, toggle the **Snapshot section** for leaner Markdown.
4. **Copy** to clipboard or **Save** to a local file.

Nothing is saved automatically; extracted scope lives in popup memory until it closes.

## Snapshot & fingerprint

Every export carries `retrievedAt`, `retrievedFrom` (credentials/query/fragment stripped), `programUrl`, `source` (method + endpoint + completeness), `platformUpdatedAt`, and a SHA-256 `fingerprint` over canonicalized content:

- **assets** — every in/out-of-scope entry (chain, address lowercased, repo, commit lowercased, tier, skills, instructions)
- **policy** — guidelines, impacts, attachments, code scope, known issues
- **rewards** — rows, tiers, pool totals, calculator text
- **program** — state fields that govern testing (status, dates, KYC/PoC flags)

Volatile counters, timestamps, ordering, whitespace, and empty fields never move the fingerprint. Partial captures omit undigested sections rather than hashing "nothing".

## Permissions

Minimal by design: `scripting` (run the matched adapter), `clipboardWrite` (Copy), `downloads` (Save), plus exact host access for the six platform origins. The service worker only sets the per-tab badge — no page access, no network calls.

## Project layout

```text
web3-scope-exporter/
├── manifest.json          # MV3 manifest (v0.5.0)
├── popup.html / popup.js / popup.css / background.js
├── lib/
│   ├── exporters.js       # Markdown + JSON renderers (Impacts, Code Scope, Known Issues)
│   └── provenance.js      # Snapshot builder + canonicalizer + SHA-256 fingerprints
├── platforms/
│   ├── immunefi.js        # 3-sub-page fetch + DOM parse
│   ├── hackenproof.js     # Nuxt embedded data → refetch → rendered fallback
│   ├── cantina.js         # Rendered DOM walk (bounties + competitions + /code shell)
│   └── registry.js        # URL → adapter dispatch
└── tests/
    ├── immunefi.test.mjs
    ├── hackenproof.test.mjs
    └── cantina.test.mjs
```

Adding a platform means one new file in `platforms/` implementing `{ id, label, matches(url), extract(context) }` plus a test — the popup and exporters stay untouched.

## Tests

Dependency-free, Node only:

```sh
cd web3-scope-exporter
for test in tests/*.test.mjs; do node "$test"; done
```

## Security

Found a vulnerability in this extension? Please open a private advisory via GitHub Security Advisories rather than a public issue. Adapters must never add authentication material, PII, or session tokens to results, logs, or exports.

## License

[MIT](LICENSE) © [CanuteTheWise](https://github.com/CanuteTheWise)

## Disclaimer

Use only with programs you are authorized to access. Exports are point-in-time copies — always verify the live page before testing.
