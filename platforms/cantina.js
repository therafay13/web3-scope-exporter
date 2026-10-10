function extractCantinaPage(kind, id, pageUrl) {
  const cleanText = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\r\n?/g, "\n").trim();
  };

  const numberOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const booleanOrNull = (value) => typeof value === "boolean" ? value : null;

  // Canonical URL is the page the export was taken from: Cantina serves
  // the same opportunity under /bounties/<uuid>, /competitions/<uuid>, and
  // /code/<uuid>/<tab> shells. The opportunity kind + id identify the
  // program; the URL identifies the capture.
  const canonicalUrl = (() => {
    try {
      const parsed = new URL(cleanText(pageUrl));
      if (parsed.protocol === "https:" &&
        (parsed.hostname === "cantina.xyz" || parsed.hostname === "www.cantina.xyz")) {
        parsed.hash = "";
        return parsed.toString();
      }
    } catch {
      // Fall through to the kind-based default below.
    }
    return kind === "competition"
      ? `https://cantina.xyz/competitions/${encodeURIComponent(id)}`
      : `https://cantina.xyz/bounties/${encodeURIComponent(id)}`;
  })();

  // "$15.5M" -> 15500000, "$2,250,000" -> 2250000, "$50k" -> 50000.
  const parseAmount = (raw) => {
    const text = cleanText(raw).replace(/^\$/, "").replace(/,/g, "").trim();
    if (!text) return null;
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?(?![a-zA-Z])/);
    if (!match) return null;
    let value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    if (match[2]) {
      const suffix = match[2].toLowerCase();
      if (suffix === "k") value *= 1000;
      else if (suffix === "m") value *= 1000000;
    }
    return value;
  };

  const parsePool = (text) => {
    // Prefer pool context ("Total reward 7,500,000 USDC", "Total Prize
    // Pool: $2,500,000") over the first stray "$X" (often the $10–$30
    // deposit!). Multi-token pools ("USDC + rEUL + USUAL") keep all tokens.
    const value = cleanText(text);
    const poolLine = /(total\s+(?:reward|prize(?:\s+pool)?)|prize\s+pool|maximum\s+reward|pool\s+total)[^\n$]{0,80}?\$?([\d,]+(?:\.\d+)?\s*[kKmM]?)/i.exec(value) ||
      /([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*(USDC|rEUL|USUAL|USDT|ETH|USD)\s*\+\s*([A-Za-z]+)/i.exec(value);
    let total = null;
    let token = "";
    if (poolLine) {
      // Multi-token form: "7,500,000 USDC + rEUL + USUAL".
      const multi = /([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*([A-Z]{2,10})\s*\+\s*(.+)/i.exec(poolLine[0]);
      if (multi) {
        total = parseAmount(`$${multi[1]}`);
        token = cleanText(`${multi[2]}+${multi[3]}`.split(/[,;]/)[0]).slice(0, 40);
      } else {
        const amount = poolLine[2] || poolLine[1];
        total = parseAmount(`$${amount}`);
        // The token often trails the match ("$50,000 USDC"): search the
        // surrounding text, not just the matched span.
        const escaped = String(amount).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tokenMatch = new RegExp(`${escaped}\\s*([A-Z]{2,10})`).exec(value) ||
          new RegExp(`${escaped}\\s*([A-Z]{2,10})`).exec(poolLine[0]);
        if (tokenMatch) token = cleanText(tokenMatch[1]);
      }
    }
    if (total === null) {
      // Fallback: largest dollar figure on the page (pool dwarfs deposits).
      const matches = [...value.matchAll(/\$([\d,]+(?:\.\d+)?\s*[kKmM]?)\s*([A-Z]{2,10})?/g)];
      let best = null;
      let bestToken = "";
      for (const match of matches) {
        const amount = parseAmount(`$${match[1]}`);
        if (amount === null) continue;
        if (best === null || amount > best) {
          best = amount;
          bestToken = cleanText(match[2] || "");
        }
      }
      if (best !== null) {
        if (best < 1000) {
          // A sub-$1000 "pool" is a deposit figure, not the pool.
          total = null;
        } else {
          total = best;
          token = bestToken;
        }
      }
    }
    return { total, token };
  };

  const extractGithubRepo = (href) => {
    const text = cleanText(href);
    const match = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(text);
    return match ? match[1].replace(/\.git$/i, "") : "";
  };

  const extractCommit = (text) => {
    const match = /\b([0-9a-f]{40})\b/i.exec(cleanText(text));
    if (match) return match[1].toLowerCase();
    const short = /\b([0-9a-f]{7,12})\b/i.exec(cleanText(text));
    return short ? short[1].toLowerCase() : "";
  };

  const isFilePath = (text) => {
    const value = cleanText(text);
    if (!value || value.length > 160) return false;
    if (/\s/.test(value)) return false;
    return /\.(sol|vy|rs|cairo|move|go|ts|js|py)$/i.test(value) || value.includes("src/") || value.includes("contracts/");
  };

  // Single ordered walk over the rendered detail page. Every heading routes
  // the tables, lists, and paragraphs below it until the next heading.
  const collectDetail = () => {
    const inScopeFiles = [];
    const outOfScopeFiles = [];
    const policyParts = [];
    const seenFiles = new Set();
    const extraRepos = [];
    const extraCommits = [];
    const chains = [];
    let repo = "";
    let commit = "";
    let build = "";
    let payoutFormula = "";
    let rewardText = "";
    let scopeText = "";
    let outOfScopeText = "";
    let currentHeading = "";
    let mode = "policy";

    const trackRepo = (found) => {
      const name = cleanText(found);
      if (!name || /cantina|docs\./i.test(name)) return;
      if (!repo) {
        repo = name;
        return;
      }
      if (name.toLowerCase() !== repo.toLowerCase() &&
        !extraRepos.some((r) => r.toLowerCase() === name.toLowerCase())) {
        extraRepos.push(name);
      }
    };

    const trackCommit = (found) => {
      const hash = cleanText(found).toLowerCase();
      if (!hash) return;
      if (!commit) {
        commit = hash;
        return;
      }
      if (hash !== commit && !extraCommits.includes(hash)) extraCommits.push(hash);
    };

    const trackChains = (text) => {
      // "### Chains" bullet lists read like "ethereum mainnet, arbitrum,
      // avalanche, ...". Capture comma-separated chain tokens generally.
      const items = cleanText(text).split(/[\n,;]+/).map(cleanText).filter(Boolean);
      for (const item of items) {
        if (item.length > 60 || /[^a-z0-9 +\-().]/i.test(item)) continue;
        if (!/mainnet|chain|arbitrum|optimism|base|polygon|avalanche|bnb|celo|blast|zora|ethereum|l2|orbit|stack/i.test(item)) {
          continue;
        }
        if (!chains.some((c) => c.toLowerCase() === item.toLowerCase())) chains.push(item);
      }
    };

    const pushFile = (list, file, role) => {
      const path = cleanText(typeof file === "string" ? file : file?.path);
      if (!path || seenFiles.has(`${list}\u0000${path}`)) return;
      seenFiles.add(`${list}\u0000${path}`);
      (list === "out" ? outOfScopeFiles : inScopeFiles).push({ path, role: cleanText(role) });
    };

    // Named contract scopes for doc-linked bounties: backticked contract
    // names (`UniswapV3Factory`), "Scope" list items naming contracts, and
    // deployment-doc links. Each becomes {name, type, group, source, note}.
    const scopeRefs = [];
    const seenRefs = new Set();
    const pushScopeRef = (name, group, source, note, type) => {
      const cleanName = cleanText(name);
      if (!cleanName || cleanName.length > 120) return;
      if (/^(scope|note|example|see|refer|below|above)$/i.test(cleanName)) return;
      const key = cleanName.toLowerCase();
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      scopeRefs.push({
        name: cleanName,
        group: cleanText(group) || currentHeading,
        source: cleanText(source),
        note: cleanText(note),
        type: cleanText(type),
      });
    };

    const trackScopeRefs = (text, group) => {
      // Backticked contract identifiers: `UniswapV3Factory`, `PoolManager.sol`.
      const codes = cleanText(text).match(/`([^`]{2,80})`/g) || [];
      for (const code of codes) {
        const name = cleanText(code.replace(/`/g, ""));
        if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(name) && /[A-Z]/.test(name)) {
          pushScopeRef(name, group, "", "");
        }
      }
    };

    // Repo links inside scope sections are scope on doc-linked bounties
    // (Euler/Coinbase/Morpho style): each linked repo becomes a scope
    // reference with the GitHub URL as its source.
    const trackRepoScopeRef = (href, group) => {
      const repo = extractGithubRepo(href);
      if (!repo || /cantina|docs\./i.test(repo)) return;
      pushScopeRef(repo, group, `https://github.com/${repo}`, "", "Repository");
      trackRepo(repo);
    };

    let ordered = [];
    try {
      const root = document.querySelector("main, #__next, [data-page], body") || document;
      ordered = Array.from(root.querySelectorAll("h1, h2, h3, h4, table, ul, ol, p, a, code"));
    } catch {
      ordered = [];
    }

    for (const node of ordered) {
      const tag = cleanText(node?.tagName).toUpperCase();
      if (/^H[1-4]$/.test(tag)) {
        const headingText = cleanText(node.textContent).replace(/\s+/g, " ");
        if (headingText) currentHeading = headingText;
        const heading = currentHeading.toLowerCase();
        // Out-of-scope subsections ("### Contracts", "X-Specific", "Website-
        // Specific", "System Roles...") follow the "Out of Scope" heading.
        // Once out, stay out until a new top-level (H1/H2) section begins:
        // exclusion content is sticky, scope content never hides beneath it.
        const isTopLevel = /^H[12]$/.test(tag);
        const isExclusionHeading = heading.includes("out of scope") || heading.includes("not eligible") ||
          heading.includes("not looking for") || heading.includes("exclusion");
        if (isExclusionHeading) {
          mode = "out";
        } else if (mode === "out" && !isTopLevel) {
          // Stay out through H3/H4 subsections beneath the Out of Scope head.
        } else if (/prize|reward|payout|scoring|severity|pool/.test(heading)) {
          mode = "rewards";
        } else if (/scope|looking for|repository|commit|files?|timeline|build|chains?|networks?|deployments?/.test(heading) ||
          /^(scope|files|build instructions)$/.test(heading)) {
          mode = "scope";
        } else if (/prohibit|disclosure|proof|poc|eligib|rules|terms|triage|submission/.test(heading)) {
          mode = "rules";
        } else {
          mode = "policy";
        }
        continue;
      }
      if (tag === "A") {
        let href = "";
        try {
          href = cleanText(node.getAttribute ? node.getAttribute("href") : node.href);
        } catch {
          href = "";
        }
        if (/github\.com\//i.test(href)) {
          trackRepo(extractGithubRepo(href));
          // A repo link under a scope-mode section is a scope reference,
          // not just metadata: doc-linked bounties define scope this way.
          if (mode === "scope") trackRepoScopeRef(href, currentHeading);
        }
        const commitInHref = /\/commit\/([0-9a-f]{7,40})\b/i.exec(href);
        if (commitInHref) trackCommit(commitInHref[1]);
        continue;
      }
      if (tag === "CODE") {
        const code = cleanText(node.textContent);
        if (/\b[0-9a-f]{7,40}\b/i.test(code)) {
          trackCommit(extractCommit(code));
        } else if (isFilePath(code)) {
          pushFile(mode === "out" ? "out" : "in", code, currentHeading);
        }
        continue;
      }
      if (tag === "TABLE") {
        let rows = [];
        try {
          rows = Array.from(node.querySelectorAll ? node.querySelectorAll("tr") : []);
        } catch {
          rows = [];
        }
        const lines = rows.map((row) => {
          let cells = [];
          try {
            cells = Array.from(row.querySelectorAll ? row.querySelectorAll("th, td") : []);
          } catch {
            cells = [];
          }
          return cells.map((cell) => cleanText(cell.innerText ?? cell.textContent)).filter(Boolean).join(" | ");
        }).filter(Boolean);
        if (lines.length === 0) continue;
        const text = lines.join("\n");
        if (mode === "rewards") rewardText = cleanText(`${rewardText}\n${text}`);
        else if (mode === "out") outOfScopeText = cleanText(`${outOfScopeText}\n${text}`);
        else if (mode === "scope") {
          scopeText = cleanText(`${scopeText}\n${text}`);
          trackScopeRefs(text, currentHeading);
          // nSLOC / file tables ("Contract | nsloc" rows): first cell that
          // looks like a file path is an in-scope file on any program.
          for (const line of lines) {
            const first = line.split("|")[0].trim().split(/\s+/)[0];
            if (isFilePath(first)) pushFile("in", first, currentHeading);
          }
        } else policyParts.push(text);
        continue;
      }
      if (tag === "UL" || tag === "OL") {
        let items = [];
        try {
          items = Array.from(node.querySelectorAll("li"), (li) =>
            cleanText(li.innerText ?? li.textContent));
        } catch {
          items = [];
        }
        const text = items.filter(Boolean).join("\n");
        if (!text) continue;
        if (mode === "out") {
          outOfScopeText = cleanText(`${outOfScopeText}\n${text}`);
          for (const item of items.filter(Boolean)) {
            if (isFilePath(item.split("\n")[0])) pushFile("out", item.split("\n")[0], currentHeading);
          }
        } else if (mode === "rewards") {
          rewardText = cleanText(`${rewardText}\n${text}`);
        } else if (mode === "scope") {
          scopeText = cleanText(`${scopeText}\n${text}`);
          trackScopeRefs(text, currentHeading);
          for (const item of items.filter(Boolean)) {
            const linkMatch = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(item);
            if (linkMatch) {
              trackRepoScopeRef(`https://github.com/${linkMatch[1]}`, currentHeading);
            }
          }
          const repoMatch = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i.exec(text);
          if (repoMatch) trackRepo(repoMatch[1].replace(/\.git$/i, ""));
          const commitMatch = /\b([0-9a-f]{7,40})\b/i.exec(text);
          if (commitMatch) trackCommit(commitMatch[1]);
          if (/forge build|forge test|git clone|yarn|npm (install|run)/i.test(text)) {
            build = cleanText(`${build}\n${text}`.trim()).slice(0, 2000);
          }
          if (/^chains?$/i.test(currentHeading) || /mainnet|chain|arbitrum|optimism/i.test(currentHeading)) {
            trackChains(text);
          } else if (items.length <= 20 && items.filter((item) =>
            /mainnet|chain|arbitrum|optimism|base|polygon|avalanche|bnb|celo|blast|zora|ethereum|l2|orbit|stack/i.test(item)).length >= Math.max(2, items.length - 1)) {
            // A short list made almost entirely of chain names is a Chains
            // list on any program, whatever the heading says.
            trackChains(text);
          }
          for (const item of items.filter(Boolean)) {
            if (isFilePath(item.split(/[\s—–-]+/)[0])) {
              pushFile("in", item.split(/[\s—–-]+/)[0], currentHeading);
            }
          }
          // nSLOC tables ("Contract | nsloc" rows) list in-scope files.
          if (/contract/i.test(currentHeading) || /nsloc/i.test(text)) {
            for (const item of items.filter(Boolean)) {
              const first = item.split("|")[0].trim().split(/\s+/)[0];
              if (isFilePath(first)) pushFile("in", first, currentHeading);
            }
          }
        } else {
          policyParts.push(text);
        }
        continue;
      }
      if (tag === "P") {
        const text = cleanText(node.innerText ?? node.textContent);
        if (!text) continue;
        trackRepo(extractGithubRepo(text));
        if (/\b[0-9a-f]{7,40}\b/i.test(text)) trackCommit(extractCommit(text));
        if (/forge build|forge test|git clone|yarn|npm (install|run)/i.test(text)) {
          build = cleanText(`${build}\n${text}`.trim()).slice(0, 2000);
        }
        if (mode === "rewards") rewardText = cleanText(`${rewardText}\n${text}`);
        else if (mode === "out") outOfScopeText = cleanText(`${outOfScopeText}\n${text}`);
        else if (mode === "scope") {
          scopeText = cleanText(`${scopeText}\n${text}`);
          trackRepo(extractGithubRepo(text));
          if (/\b[0-9a-f]{7,40}\b/i.test(text)) trackCommit(extractCommit(text));
          if (/^chains?$/i.test(currentHeading)) trackChains(text);
        } else policyParts.push(text);
        if (/final payout|base severity|impact score|multiplier/i.test(text) && !payoutFormula) {
          payoutFormula = text.slice(0, 1000);
        }
        continue;
      }
    }

    return {
      inScopeFiles, outOfScopeFiles, policyParts, scopeRefs,
      repo, commit, extraRepos, extraCommits, chains,
      build: cleanText(build),
      payoutFormula: cleanText(payoutFormula),
      rewardText: cleanText(rewardText),
      scopeText: cleanText(scopeText),
      outOfScopeText: cleanText(outOfScopeText),
    };
  };

  // Per-group severity caps ("Critical: $15,500,000", "Up to $2,250,000",
  // "Critical Impact Examples (Maximum Reward: $X)") -> structured rows.
  const parseSeverityCaps = (text) => {
    const tiers = [
      { label: "Critical", slot: "critical", keys: ["critical"] },
      { label: "High", slot: "high", keys: ["high"] },
      { label: "Medium", slot: "medium", keys: ["medium", "moderate"] },
      { label: "Low", slot: "low", keys: ["low"] },
    ];
    const rows = [];
    for (const tier of tiers) {
      const names = tier.keys.join("|");
      const cap = new RegExp(
        `(?:${names})[^$\\n]{0,120}?(?:maximum reward|max|up to|capped[^$\\n]{0,40}?)\\s*:?\\s*\\$([\\d,]+(?:\\.\\d+)?\\s*[kKmM]?)(?![a-zA-Z])`,
        "i",
      ).exec(text);
      const range = cap ? null : new RegExp(
        `(?:${names})[^$\\n]{0,80}?\\$([\\d,]+(?:\\.\\d+)?\\s*[kKmM]?)(?![a-zA-Z])\\s*[\\-–—]\\s*\\$([\\d,]+(?:\\.\\d+)?\\s*[kKmM]?)(?![a-zA-Z])`,
        "i",
      ).exec(text);
      const match = cap || range;
      if (!match) continue;
      const max = parseAmount(`$${cap ? match[1] : match[2]}`);
      const min = cap ? null : parseAmount(`$${match[1]}`);
      if (max === null) continue;
      rows.push({
        name: tier.label,
        asset: "",
        useRange: min !== null && min !== max,
        amounts: {
          low: tier.slot === "low" ? max : null,
          lowMinimum: tier.slot === "low" ? min : null,
          medium: tier.slot === "medium" ? max : null,
          mediumMinimum: tier.slot === "medium" ? min : null,
          high: tier.slot === "high" ? max : null,
          highMinimum: tier.slot === "high" ? min : null,
          critical: tier.slot === "critical" ? max : null,
          criticalMinimum: tier.slot === "critical" ? min : null,
        },
      });
    }
    return rows;
  };

  const collectHeader = () => {
    const header = { title: "", poolText: "", stateText: "", dateText: "" };
    try {
      const h1 = document.querySelector("h1");
      header.title = cleanText(h1?.textContent);
      const body = cleanText(document.body?.innerText ?? "");
      const poolMatch = /\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?:\s*(?:USDC|USDT|ETH|USD))?/i.exec(body.slice(0, 4000));
      if (poolMatch) header.poolText = poolMatch[0];
      if (/\bcompleted\b/i.test(body.slice(0, 2000))) header.stateText = "Completed";
      else if (/\blive\b/i.test(body.slice(0, 2000))) header.stateText = "Live";
      const dateMatch = /(started on|ends in|ended on)\s+([^\n]{1,60})/i.exec(body.slice(0, 4000));
      if (dateMatch) header.dateText = cleanText(dateMatch[0]);
    } catch {
      // Header is convenience; the detail walk below still applies.
    }
    return header;
  };

  const buildResult = (ctx) => {
    const detail = ctx.detail;
    const header = ctx.header || {};
    ctx.kind = ctx.kind || kind;
    // The /code/<uuid> shell hosts both bounties and competitions. Resolve
    // from page content, not URL keywords: a frozen commit or prize pool
    // means competition; a payout calculator or per-group severity caps
    // mean bounty. Defaults to bounty (evergreen) when ambiguous.
    let resolvedKind = ctx.kind;
    if (resolvedKind === "opportunity") {
      const hasCommit = Boolean(detail.commit) || /\bcommit\b/i.test(detail.scopeText);
      const hasPool = /prize pool|total prize|scoring/i.test(`${header.poolText}\n${detail.rewardText}`);
      const hasCalculator = /final payout|payout calculator/i.test(`${detail.payoutFormula}\n${detail.rewardText}`);
      resolvedKind = (hasCommit || hasPool) && !hasCalculator ? "competition" : "bounty";
    }
    const policyText = detail.policyParts
      .map(cleanText).filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("\n\n");
    // Severity caps appear under rewards headings on competitions but
    // inside per-group scope blocks on bounties — scan all of it.
    const rewardRows = parseSeverityCaps(
      [detail.rewardText, detail.scopeText, policyText].filter(Boolean).join("\n"),
    );
    const pool = parsePool(`${header.poolText}\n${detail.rewardText}`);
    const maximums = rewardRows
      .map((row) => Object.values(row.amounts || {}).filter((v) => typeof v === "number"))
      .map((values) => values.length > 0 ? Math.max(...values) : null)
      .filter((v) => v !== null);
    const poolTotal = pool.total !== null ? pool.total
      : maximums.length > 0 ? Math.max(...maximums) : null;

    const inScope = detail.inScopeFiles.map((file) => ({
      asset: file.path,
      type: "Smart Contract",
      group: file.role || "Scope",
      filePath: file.path,
      repo: detail.repo,
      commit: detail.commit,
      instruction: "",
    }));
    // Doc-linked bounties (Uniswap/Coinbase/Morpho style) define scope via
    // named contract scopes + deployment-doc links instead of file tables.
    // Capture each as a scope reference: the named scope is the asset, the
    // doc/repo URL is its source. This is scope, not policy prose.
    const seenRefs = new Set(inScope.map((entry) => entry.asset.toLowerCase()));
    for (const ref of detail.scopeRefs) {
      const key = cleanText(ref.name).toLowerCase();
      if (!key || seenRefs.has(key)) continue;
      seenRefs.add(key);
      inScope.push({
        asset: cleanText(ref.name),
        type: cleanText(ref.type) || "Smart Contract",
        group: cleanText(ref.group) || "Scope",
        source: cleanText(ref.source),
        repo: detail.repo,
        commit: detail.commit,
        instruction: cleanText(ref.note),
      });
    }
    const outOfScope = detail.outOfScopeFiles.map((file) => ({
      asset: file.path,
      type: "",
      group: "Out of Scope",
      filePath: file.path,
      instruction: file.role,
    }));

    const notes = [];
    const complete = (inScope.length > 0 || Boolean(detail.repo)) && Boolean(policyText);
    if (!complete) {
      notes.push("Partial export: Cantina's scope files or policy text could not be fully retrieved from the rendered page.");
    }
    if (detail.scopeRefs.length > 0 && detail.inScopeFiles.length === 0 && !detail.repo) {
      notes.push("Scope on this bounty is defined by named contract scopes and deployment references rather than a file list; see the In Scope table sources.");
    }

    return {
      platform: "cantina",
      program: {
        name: cleanText(header.title),
        handle: id,
        url: canonicalUrl,
        website: detail.repo ? `https://github.com/${detail.repo}` : "",
        about: cleanText(detail.scopeText.split("\n")[0]),
      },
      capture: {
        source: {
          method: "rendered-page",
          description: resolvedKind === "competition"
            ? "Cantina competition page (rendered)"
            : "Cantina bounty page (rendered)",
          endpoint: canonicalUrl,
        },
        platformUpdatedAt: {},
      },
      metadata: {
        kind: resolvedKind,
        id,
        state: cleanText(header.stateText),
        dateText: cleanText(header.dateText),
        poolTotal,
        poolToken: pool.token,
        repo: detail.repo,
        commit: detail.commit,
        additionalRepos: detail.extraRepos,
        additionalCommits: detail.extraCommits,
      },
      guidelines: {
        policy: policyText,
        policySourceUrl: "",
        scopeDescription: cleanText(detail.scopeText),
        outOfScopeDescription: cleanText(detail.outOfScopeText),
        faq: "",
        severityAssessment: "",
        introduction: "",
        disclosure: "",
        accountAccess: "",
        qualifyingVulnerabilities: [],
        nonQualifyingVulnerabilities: [],
        testingRequirements: {},
        safeHarbor: { cantina: null },
        updatedAt: "",
        platformStandardsExclusions: [],
        exemplaryStandardsExclusions: [],
        scopeExclusions: [],
      },
      rewards: {
        currency: /\$[\d,]/.test(`${header.poolText}\n${detail.rewardText}`) ? "USD" : "",
        description: cleanText(`${detail.rewardText}\n\n${detail.payoutFormula}`),
        poolTotal,
        poolToken: pool.token,
        calculator: detail.payoutFormula,
        minimumReward: null,
        maximumReward: maximums.length > 0 ? Math.max(...maximums) : poolTotal,
        updatedAt: "",
        rows: rewardRows,
        tiers: [],
      },
      attachments: [detail.repo, ...detail.extraRepos].filter(Boolean).map((name) => ({
        section: "Repository",
        fileName: name,
        fileSize: null,
        contentType: "",
      })),
      codeScope: {
        repo: detail.repo,
        commit: detail.commit,
        additionalRepos: detail.extraRepos,
        additionalCommits: detail.extraCommits,
        files: detail.inScopeFiles.map((file) => file.path),
        outOfScopeFiles: detail.outOfScopeFiles.map((file) => file.path),
        chains: detail.chains,
        build: detail.build,
      },
      inScope,
      outOfScope,
      impacts: [],
      knownIssues: [],
      knownIssuesAvailable: false,
      notes,
      ...(complete ? {} : { _partial: true }),
    };
  };

  // The /code/<uuid> shell splits content across tab views (overview,
  // scope, ...). The Scope tab may render client-side after the Overview
  // walk, or live behind a query-param view. Try the scope-tab URL variants
  // same-origin and merge any scope content found there. Auth-gated tabs
  // (login wall HTML) are detected and reported, never parsed as scope.
  const LOGIN_WALL = /welcome|log in with your email|don't have an account\?/i;

  const fetchScopeTab = async () => {
    const variants = ["scope", "overview?overviewTab=1", "overview?tab=scope"];
    for (const variant of variants) {
      const url = `${location.origin}/code/${encodeURIComponent(id)}/${variant}`;
      if (cleanText(pageUrl).split("?")[0] === url.split("?")[0] &&
        cleanText(pageUrl).includes(variant.split("?")[0])) {
        continue;
      }
      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "text/html" },
        });
        if (!response || !response.ok) continue;
        const html = await response.text();
        if (!html || LOGIN_WALL.test(html.slice(0, 8000))) return { gated: true };
        if (/<table|scope|repository|commit/i.test(html)) return { html };
      } catch {
        // A failed variant never blocks the other variants or the DOM walk.
      }
    }
    return null;
  };

  const main = async () => {
    if (typeof location === "undefined" ||
      location.protocol !== "https:" ||
      (location.hostname !== "cantina.xyz" && location.hostname !== "www.cantina.xyz")) {
      throw new Error("Open a Cantina bounty or competition page and try again.");
    }
    const header = collectHeader();
    const detail = collectDetail();
    // On /code/ shells with an empty scope walk, try the Scope tab views
    // before declaring partial: parse their tables/lists into the detail.
    let scopeTabGated = false;
    if (/\/code\//i.test(cleanText(pageUrl)) &&
      detail.inScopeFiles.length === 0 && !detail.repo) {
      const tab = await fetchScopeTab();
      if (tab?.gated) {
        scopeTabGated = true;
      } else if (tab?.html) {
        try {
          const doc = new DOMParser().parseFromString(tab.html, "text/html");
          const tables = Array.from(doc.querySelectorAll("table"));
          for (const table of tables) {
            const rows = Array.from(table.querySelectorAll("tr"));
            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll("th, td"));
              const line = cells.map((cell) => cleanText(cell.textContent)).filter(Boolean).join(" | ");
              if (line) detail.scopeText = cleanText(`${detail.scopeText}\n${line}`);
            }
          }
        } catch {
          // Tab HTML is enhancement-only; the DOM walk still stands.
        }
      }
    }
    const data = buildResult({ header, detail });
    if (scopeTabGated) {
      data.notes.push("The Scope tab required sign-in; scope files below cover only what the Overview rendered. Check the live Scope tab for the full asset list before testing.");
    }
    if (data._partial) {
      data.capture.source.complete = false;
      delete data._partial;
    } else if (data.codeScope.files.length === 0 && !data.codeScope.repo) {
      data.capture.source.complete = false;
      data.notes.push("Partial export: no repository or file scope was found on this page; it may still be loading or behind the Scope tab.");
    }
    return data;
  };

  return main()
    .then((data) => ({ ok: true, data }))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Could not extract this Cantina opportunity's scope.",
    }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getOpportunity(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "cantina.xyz" && parsed.hostname !== "www.cantina.xyz") return null;
    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments.length < 2) return null;
    const [section, id] = segments;
    if (section === "bounties" && segments.length === 2 && UUID_RE.test(id)) {
      return { kind: "bounty", id };
    }
    if (section === "competitions" && segments.length === 2 &&
      (UUID_RE.test(id) || id.toLowerCase() === "pectra")) {
      return { kind: "competition", id };
    }
    // Code-review workspace shell for the same opportunities:
    // /code/<uuid>[/<tab>], e.g. /code/<uuid>/overview (bounty detail),
    // /code/<uuid>/scope. Kind is resolved at extract time when possible;
    // matching here is deliberately kind-agnostic ("opportunity").
    if (section === "code" && UUID_RE.test(id)) {
      return { kind: "opportunity", id };
    }
    return null;
  } catch {
    return null;
  }
}

const cantina = {
  id: "cantina",
  label: "Cantina",

  matches(url) {
    return Boolean(getOpportunity(url));
  },

  async extract(context) {
    const opportunity = getOpportunity(context.url);
    if (!opportunity) {
      throw new Error("Open a Cantina bounty or competition page and try again.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      world: "MAIN",
      func: extractCantinaPage,
      args: [opportunity.kind, opportunity.id, context.url],
    });
    const result = results?.[0]?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "Could not extract this Cantina opportunity's scope.");
    }
    return result.data;
  },
};

export default cantina;
