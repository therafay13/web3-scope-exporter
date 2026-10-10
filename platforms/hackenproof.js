function extractHackenProofPage(slug) {
  const cleanText = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\r\n?/g, "\n").trim();
  };

  const cleanList = (value) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
      const text = cleanText(item);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out;
  };

  const booleanOrNull = (value) => typeof value === "boolean" ? value : null;

  const canonicalUrl = `https://hackenproof.com/programs/${encodeURIComponent(slug)}`;

  // "$50,000" -> 50000, "50000.0" -> 50000, "$50k" -> 50000, "" -> null.
  const parseAmount = (raw) => {
    const text = cleanText(raw).replace(/^\$/, "").replace(/,/g, "").trim();
    if (!text) return null;
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?/);
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

  // Normalized identity for target dedup: "https://WWW.Acme.Finance/" and
  // "acme.finance" are the same target. Lowercase, strip scheme, www, and
  // trailing slashes so a name cell and a URL cell for the same host merge.
  const normalizeAssetKey = (raw) => {
    let key = cleanText(raw).toLowerCase();
    if (!key) return "";
    key = key.replace(/^(https?:)?\/\//, "");
    key = key.replace(/^www\./, "");
    try {
      key = decodeURIComponent(key);
    } catch {
      // Keep the raw key when decoding fails.
    }
    key = key.replace(/\/+$/, "").replace(/:+$/, "");
    return key;
  };

  // Site chrome that is never policy: nav menus, marketing blocks, footer
  // links. Rendered pages include the whole shell; the brief is a fraction.
  // Live pages deliver chrome as MULTI-LINE blobs ("Products & Services\n
  // Solutions\n..."), so matching runs per line: a block is chrome when
  // most of its lines are chrome lines, or it contains a chrome signature.
  const CHROME_LINE = [
    /^(products|solutions|hackers|company|resources)(\s|$)/i,
    /^(bug bounty|penetration testing|vulnerability triage|vulnerability disclosure|audit types|ctf challenges|agentic ai triager)\b/i,
    /^(fintech|banks|neobanks|blockchain|government|healthcare|ai|post-quantum)\s*$/i,
    /^(start hacking|leaderboard|community|integrations|case studies|blog|docs|audit portfolio|brandbook)\s*$/i,
    /^(about us|contacts|referral program|privacy notice|terms|cookies settings)\s*$/i,
    /^(bug bounty|penetration testing|vulnerability triage|audit types).{0,80}(web2|web3|teams|researchers|app|code|scope)/i,
    /^(sui security expansion|ethereum security program|for ai agents)\b/i,
  ];

  const CHROME_SIGNATURE = [
    /join \d+[,\d]*\+? researchers/i,
    /©.*hackenproof/i,
    /^202\d\s*©/i,
    /all rights reserved\.?\s*$/i,
  ];

  const isChromeLine = (line) => CHROME_LINE.some((pattern) => pattern.test(cleanText(line)));

  // Known chrome phrases matched as substrings: live pages concatenate nav
  // items without newlines ("Bug BountyPay-for-results bounty programs..."),
  // so line-splitting alone never sees them.
  const CHROME_PHRASE = [
    "pay-for-results bounty programs",
    "kick-off within 24 hours",
    "without the ai-generated noise",
    "safe, public channel for researchers",
    "ctf competitions for web3",
    "compare curated, crowdsourced",
    "hand-picked, vetted researchers",
    "crowdsourced layer on top",
    "verified researchers test only your defined scope",
    "security audits for blockchain protocols",
    "crowdsourced security audits for your smart contract",
    "sui foundation program",
    "erc-4337 account abstraction",
    "directory of ai security agents",
    "sign up, pick a program",
    "top-ranked security researchers",
    "trade tips and bounty news",
    "guides on programs, scope, rules",
    "who we are and the team behind",
    "talk to our team about your security needs",
    "refer companies to hackenproof",
    "browse completed audits",
    "vulnerability breakdowns, guides",
    "how okx, near, and vechain",
    "sync validated reports to jira",
    "platform documentation for companies",
    "logos, colors, and guidelines",
    "join 82,000+ researchers",
  ];

  const isChrome = (text) => {
    const value = cleanText(text);
    if (!value) return true;
    if (CHROME_SIGNATURE.some((pattern) => pattern.test(value))) return true;
    const lowered = value.toLowerCase();
    let phraseHits = 0;
    for (const phrase of CHROME_PHRASE) {
      if (lowered.includes(phrase)) phraseHits += 1;
    }
    // Two or more distinct chrome phrases = nav/marketing blob, whatever
    // its line shape.
    if (phraseHits >= 2) return true;
    const lines = value.split("\n").map(cleanText).filter(Boolean);
    if (lines.length === 0) return true;
    if (lines.length === 1) return isChromeLine(lines[0]) || phraseHits >= 1;
    if (value.length > 4000) return false;
    const chromeLines = lines.filter(isChromeLine).length;
    return chromeLines >= 3 && chromeLines / lines.length >= 0.7;
  };

  // Ancestor-tag skip: nav/header/footer/aside elements are chrome whatever
  // text they hold. Far more robust than text matching for concatenated
  // live DOM blobs.
  const insideChromeLandmark = (node) => {
    try {
      let current = node?.parentElement;
      for (let i = 0; i < 6 && current; i += 1) {
        const tag = cleanText(current.tagName).toUpperCase();
        if (tag === "NAV" || tag === "HEADER" || tag === "FOOTER" || tag === "ASIDE") return true;
        const role = cleanText(current.getAttribute ? current.getAttribute("role") : "").toLowerCase();
        if (role === "navigation" || role === "banner" || role === "contentinfo") return true;
        current = current.parentElement;
      }
    } catch {
      // A hostile getter must not break the walk.
    }
    return false;
  };

  // Copy-button text ("Copy", "Copied") appended to target cells by the UI,
  // inline ("...?chain=mainnet Copy Copied Smart Contract - x") or trailing.
  const stripCopyButtons = (text) => {
    let value = cleanText(text);
    value = value.replace(/\s*\bcopy\b\s*\bcopied\b\s*/gi, " ");
    value = value.replace(/\s*\bcopy\b\s*/gi, " ");
    value = value.replace(/\s*\bcopied\b\s*$/i, "");
    return cleanText(value.replace(/\s+/g, " "));
  };

  // Target cells pack URL + label ("<url> Copy Copied Smart Contract - x"):
  // split the URL from the trailing label so assets stay clean.
  const splitTargetCell = (text) => {
    const value = stripCopyButtons(text);
    const match = /^(https?:\/\/\S+)\s+(.+)$/.exec(value);
    if (match) return { url: match[1], label: cleanText(match[2]) };
    return { url: value, label: "" };
  };

  const normalizeAddress = (value) => {
    const text = cleanText(value);
    if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return "";
    return text.toLowerCase();
  };

  // The Nuxt 3 SSR payload nests the program several levels deep and uses
  // index refs, so the payload is walked as a plain object tree for the
  // first program-shaped node: an object carrying scopes[] plus rewards or
  // a title. Bounded (50k visits, depth 12) against hostile payloads.
  const findProgram = (root) => {
    const stack = [{ node: root, depth: 0 }];
    let visits = 0;
    while (stack.length > 0) {
      const { node, depth } = stack.pop();
      if (!node || typeof node !== "object") continue;
      visits += 1;
      if (visits > 50000) return null;
      if (depth > 12) continue;
      if (!Array.isArray(node) && Array.isArray(node.scopes) &&
        (node.rewards !== undefined || typeof node.title === "string")) {
        return node;
      }
      const children = Array.isArray(node) ? node : Object.values(node);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push({ node: children[i], depth: depth + 1 });
      }
    }
    return null;
  };

  const splitScopes = (scopes) => {
    const inScope = [];
    const outOfScope = [];
    const seen = new Set();
    const list = Array.isArray(scopes) ? scopes : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const asset = cleanText(item.target);
      if (!asset) continue;
      const out = item.out_of_scope === true;
      const key = `${out ? "out" : "in"}\u0000${normalizeAssetKey(asset)}`;
      const entry = {
        asset,
        type: cleanText(item.title),
        maxSeverity: cleanText(item.criticality),
        instruction: cleanText(item.target_description),
      };
      if (seen.has(key)) {
        // Duplicate row for the same target: keep the first, fill gaps.
        const bucket = out ? outOfScope : inScope;
        const existing = bucket.find((row) => normalizeAssetKey(row.asset) === normalizeAssetKey(asset));
        if (existing) {
          if (!existing.type && entry.type) existing.type = entry.type;
          if (!existing.maxSeverity && entry.maxSeverity) existing.maxSeverity = entry.maxSeverity;
          if (!existing.instruction && entry.instruction) existing.instruction = entry.instruction;
        }
        continue;
      }
      seen.add(key);
      (out ? outOfScope : inScope).push(entry);
    }
    return { inScope, outOfScope };
  };

  // Embedded rewards matrix -> structured rows on the shared severity slots
  // so every platform's rewards stay comparable in exports and fingerprints.
  const buildRewardRows = (rewards) => {
    const source = rewards && typeof rewards === "object" ? rewards : {};
    const tiers = [
      { label: "Critical", slot: "critical", maxKey: "critical_max", minKey: "critical_min" },
      { label: "High", slot: "high", maxKey: "high_max", minKey: "high_min" },
      { label: "Medium", slot: "medium", maxKey: "medium_max", minKey: "medium_min" },
      { label: "Low", slot: "low", maxKey: "low_max", minKey: "low_min" },
    ];
    const rows = [];
    for (const tier of tiers) {
      const max = parseAmount(source[tier.maxKey]);
      const min = parseAmount(source[tier.minKey]);
      if (max === null && min === null) continue;
      rows.push({
        name: tier.label,
        asset: "",
        useRange: min !== null && max !== null && min !== max,
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

  const rewardTotals = (rows) => {
    const values = [];
    for (const row of rows) {
      for (const value of Object.values(row.amounts || {})) {
        if (typeof value === "number") values.push(value);
      }
    }
    return {
      minimumReward: values.length > 0 ? Math.min(...values) : null,
      maximumReward: values.length > 0 ? Math.max(...values) : null,
    };
  };

  const repoFileName = (repoLink) => {
    const link = cleanText(repoLink);
    if (!link) return "";
    try {
      const base = decodeURIComponent(link.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "");
      return cleanText(base) || link;
    } catch {
      return link;
    }
  };

  const baseScope = () => ({
    platform: "hackenproof",
    program: { name: "", handle: slug, url: canonicalUrl, website: "", about: "" },
    capture: { source: { method: "", description: "", endpoint: canonicalUrl }, platformUpdatedAt: {} },
    metadata: {},
    guidelines: {
      policy: "",
      policySourceUrl: "",
      scopeDescription: "",
      outOfScopeDescription: "",
      faq: "",
      severityAssessment: "",
      introduction: "",
      disclosure: "",
      accountAccess: "",
      qualifyingVulnerabilities: [],
      nonQualifyingVulnerabilities: [],
      testingRequirements: {},
      safeHarbor: { hackenproof: null },
      updatedAt: "",
      platformStandardsExclusions: [],
      exemplaryStandardsExclusions: [],
      scopeExclusions: [],
    },
    rewards: { currency: "", description: "", minimumReward: null, maximumReward: null, updatedAt: "", rows: [], tiers: [] },
    attachments: [],
    inScope: [],
    outOfScope: [],
    impacts: [],
    knownIssues: [],
    notes: [],
  });

  const finalize = (data, complete) => {
    if (!complete) {
      data.capture.source.complete = false;
      data.notes.push(
        "Partial export: the embedded program data could not be retrieved, so only the rendered page content was exported.",
      );
    }
    return data;
  };

  // Path (1): embedded program node from __NUXT_DATA__ (live or refetched).
  // Only whitelisted scope keys are copied: leaderboard PII (nicknames,
  // avatars), submitUrl tokens, and anything beyond scope never enter the
  // export even when present in the payload.
  const normalizeEmbedded = (program, method, description) => {
    const data = baseScope();
    const { inScope, outOfScope } = splitScopes(program.scopes);

    const policyText = [program.description, program.programRules, program.focusArea,
      program.eligibilityAndCoordinateDisclosure, program.disclosureGuidelines]
      .map(cleanText)
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("\n\n");

    const outOfScopeText = outOfScope
      .map((row) => cleanText(row.instruction ? `${row.asset} — ${row.instruction}` : row.asset))
      .filter(Boolean)
      .join("\n");

    const labels = program.labels && typeof program.labels === "object" ? program.labels : {};
    const rows = buildRewardRows(program.rewards);
    const totals = rewardTotals(rows);
    const rewardSignal = [program.maxReward, program.minReward, program.maxBounty, program.minBounty]
      .map(cleanText).join(" ");
    const hasDollar = /\$[\d,]/.test(rewardSignal);
    const repoLink = cleanText(program.repoLink);

    data.program = {
      name: cleanText(program.title),
      handle: slug,
      url: canonicalUrl,
      website: repoLink,
      about: cleanText(program.companyName),
    };
    data.capture = {
      source: { method, description, endpoint: canonicalUrl },
      platformUpdatedAt: cleanText(program.endDate || program.startDate)
        ? { program: cleanText(program.endDate || program.startDate) }
        : {},
    };
    data.metadata = {
      companyName: cleanText(program.companyName),
      companySlug: cleanText(program.companySlug),
      state: cleanText(program.state),
      status: cleanText(program.status),
      startDate: cleanText(program.startDate),
      endDate: cleanText(program.endDate),
      isUnending: booleanOrNull(program.isUnending),
      kycRequired: booleanOrNull(program.kycRequired),
      pocRequired: booleanOrNull(program.pocRequired),
      reputationRequired: booleanOrNull(program.reputationRequired),
      minReputation: typeof program.minReputation === "number" && Number.isFinite(program.minReputation)
        ? program.minReputation : cleanText(program.minReputation),
      maxReward: cleanText(program.maxReward),
      maxBountyAmount: parseAmount(program.maxBounty),
      minBountyAmount: parseAmount(program.minBounty),
      labels: {
        types: cleanList(labels.types),
        languages: cleanList(labels.languages),
        platforms: cleanList(labels.platforms),
        project_types: cleanList(labels.project_types),
      },
      totalRewards: typeof program.totalRewards === "number" ? program.totalRewards : cleanText(program.totalRewards),
      submittedReports: typeof program.submittedReports === "number"
        ? program.submittedReports : cleanText(program.submittedReports),
    };
    // Focus Area is the program's in-scope prose: what is in focus.
    data.guidelines.policy = policyText;
    data.guidelines.scopeDescription = cleanText(program.focusArea);
    data.guidelines.outOfScopeDescription = outOfScopeText;
    data.guidelines.disclosure = cleanText(program.disclosureGuidelines);
    data.guidelines.testingRequirements = {
      poc: booleanOrNull(program.pocRequired),
      kyc: booleanOrNull(program.kycRequired),
      minReputation: typeof program.minReputation === "number" && Number.isFinite(program.minReputation)
        ? program.minReputation : null,
    };
    data.rewards = {
      currency: hasDollar ? "USD" : "",
      description: "",
      minimumReward: totals.minimumReward,
      maximumReward: totals.maximumReward,
      updatedAt: "",
      rows,
      tiers: [],
    };
    if (repoLink) {
      data.attachments.push({
        section: "Repository",
        fileName: repoFileName(repoLink),
        fileSize: null,
        contentType: "",
      });
    }
    data.inScope = inScope;
    data.outOfScope = outOfScope;
    // Impacts only qualify from explicit Severity+title pairs; the embedded
    // schema carries none, so this stays empty rather than guessing from prose.
    data.impacts = [];
    data.knownIssues = [];

    const complete = inScope.length > 0 && Boolean(policyText);
    return finalize(data, complete);
  };

  // Path (2): rendered DOM fallback. Target tables carry Target|Type|Severity
  // headers; reward/policy markdown sections are routed by heading.
  const collectRendered = () => {
    const inScope = [];
    const outOfScope = [];
    const policyParts = [];
    const seen = new Set();
    let rewardsText = "";
    let scopeText = "";
    let outOfScopeText = "";
    let currentHeading = "";
    let outMode = false;
    let rewardMode = false;
    // Leaderboard / reports / activity sections carry researcher PII
    // (nicknames, avatars). They are never scope: skipped wholesale.
    let skipMode = false;

    const cellText = (cell) => cleanText(cell?.innerText ?? cell?.textContent ?? "");

    const pushAsset = (bucket, asset, type, maxSeverity, instruction, address = "", chain = "") => {
      const name = stripCopyButtons(asset);
      if (!name) return;
      const key = `${bucket}\u0000${normalizeAssetKey(name)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const entry = {
        asset: name,
        type: cleanText(type),
        maxSeverity: cleanText(maxSeverity),
        instruction: cleanText(instruction),
      };
      const normalized = normalizeAddress(address || name);
      if (normalized) entry.address = normalized;
      if (chain) entry.chain = cleanText(chain);
      (bucket === "out" ? outOfScope : inScope).push(entry);
    };

    // A table is out-of-scope when its own caption/context says so — not
    // just when the page-level heading does. ADI-style pages render a
    // second Target|Type|Severity table under an "Out of scope" subheading
    // while the page heading still reads "In scope".
    const tableIsOutOfScope = (table) => {
      try {
        let node = table?.previousElementSibling;
        for (let i = 0; i < 4 && node; i += 1) {
          const text = cleanText(node.innerText ?? node.textContent).toLowerCase();
          if (/out of scope|out-of-scope|deprecated/.test(text)) return true;
          if (/in scope|in-scope/.test(text)) return false;
          node = node.previousElementSibling;
        }
      } catch {
        // Fall through to the page-level mode.
      }
      return outMode;
    };

    const parseTargetTable = (table) => {
      let rows = [];
      try {
        rows = Array.from(table?.querySelectorAll ? table.querySelectorAll("tr") : []);
      } catch {
        rows = [];
      }
      if (rows.length === 0) return;
      const cellsOf = (row) => {
        try {
          return Array.from(row?.querySelectorAll ? row.querySelectorAll("th, td") : []);
        } catch {
          return [];
        }
      };
      const headerCells = cellsOf(rows[0]).map((cell) => cellText(cell).toLowerCase());
      const hasTh = (rows[0]?.querySelectorAll?.("th")?.length || 0) > 0;
      const targetColumn = headerCells.findIndex((cell) => cell.includes("target"));
      const contractColumn = headerCells.findIndex((cell) => cell.includes("contract"));
      const addressColumn = headerCells.findIndex((cell) => cell.includes("address"));
      // Target tables (Target|Type|Severity) and deployed-contract tables
      // (Contract|Address). Detail cards and leaderboard tables are neither.
      const isTargetTable = targetColumn >= 0;
      const isContractTable = !isTargetTable && contractColumn >= 0 && addressColumn >= 0;
      if (!isTargetTable && !isContractTable) return;
      const typeColumn = headerCells.findIndex((cell) => cell.includes("type"));
      const severityColumn = headerCells.findIndex((cell) => cell.includes("sever"));
      const body = hasTh ? rows.slice(1) : rows;
      const bucket = tableIsOutOfScope(table) ? "out" : "in";
      for (const row of body) {
        const cells = cellsOf(row);
        if (cells.length === 0) continue;
        if (isContractTable) {
          const name = stripCopyButtons(cellText(cells[contractColumn]));
          const address = cleanText(cellText(cells[addressColumn]));
          const normalized = normalizeAddress(address);
          if (!normalized) continue;
          pushAsset(
            bucket,
            normalized,
            "Smart Contract",
            "",
            name && name.toLowerCase() !== normalized ? name : "",
            normalized,
            "Ethereum",
          );
          continue;
        }
        const split = splitTargetCell(cellText(cells[targetColumn]));
        const label = typeColumn >= 0 ? cleanText(cellText(cells[typeColumn])) : "";
        pushAsset(
          bucket,
          split.url,
          label || split.label,
          severityColumn >= 0 ? cellText(cells[severityColumn]) : "",
          label && split.label && split.label !== label ? split.label : "",
        );
      }
    };

    // Detail-card labels ("Smart Contract - v0-assets") repeat the target
    // table's Type column as loose text. They are asset context, never
    // policy: consume them so they don't pollute the policy fingerprint.
    const isDetailCardLabel = (text) => {
      const value = cleanText(text);
      if (!value || value.length > 120 || value.includes("\n")) return false;
      return /^(smart contract|bridge|web|api|ios|android|network|chain|program)\s*[-–—:]\s*.+/i.test(value);
    };

    // Focus Area is the program's in-scope prose. Track it separately so
    // scopeDescription prefers it over stray heading text.
    let focusAreaText = "";
    let inFocusArea = false;

    let ordered = [];
    try {
      const root = (typeof document !== "undefined" && document.querySelector
        ? document.querySelector("main") : null) ||
        (typeof document !== "undefined" ? document : null);
      ordered = root && root.querySelectorAll
        ? Array.from(root.querySelectorAll("h1, h2, h3, h4, table, ul, ol, p, div"))
        : [];
    } catch {
      ordered = [];
    }

    for (const node of ordered) {
      const tag = cleanText(node?.tagName).toUpperCase();
      if (/^H[1-4]$/.test(tag)) {
        const headingText = cleanText(node.textContent).replace(/\s+/g, " ");
        if (headingText) currentHeading = headingText;
        const heading = currentHeading.toLowerCase();
        outMode = heading.includes("out of scope") || heading.includes("out-of-scope");
        rewardMode = /reward|payout|bounty|threat level/.test(heading) && !outMode;
        skipMode = /leaderboard|hall of fame|top hackers|researchers|reports|activity|statistics/.test(heading);
        inFocusArea = /focus\s*area/.test(heading) && !outMode;
        continue;
      }
      if (skipMode) continue;
      if (insideChromeLandmark(node)) continue;
      if (tag === "TABLE") {
        parseTargetTable(node);
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
        if (!text || isChrome(text)) continue;
        if (outMode) outOfScopeText = cleanText(`${outOfScopeText}\n${text}`);
        else if (rewardMode) rewardsText = cleanText(`${rewardsText}\n${text}`);
        else policyParts.push(text);
        continue;
      }
      if (tag === "P" || tag === "DIV") {
        const text = cleanText(node.innerText ?? node.textContent);
        if (!text || isChrome(text)) continue;
        // Detail-card labels are asset context consumed at parse time.
        if (isDetailCardLabel(text)) continue;
        if (outMode) {
          if (!cleanText(outOfScopeText).includes(text)) {
            outOfScopeText = cleanText(`${outOfScopeText}\n${text}`);
          }
          continue;
        }
        if (rewardMode) {
          // Nested divs repeat their children's text; keep each block once.
          if (!cleanText(rewardsText).includes(text)) {
            rewardsText = cleanText(`${rewardsText}\n${text}`);
          }
          continue;
        }
        if (tag === "DIV") continue;
        if (inFocusArea) {
          focusAreaText = cleanText(`${focusAreaText}\n${text}`);
        }
        if (!scopeText && /^(targets?|in.?scope)\b/i.test(currentHeading)) scopeText = text;
        policyParts.push(text);
      }
    }

    return { inScope, outOfScope, policyParts, rewardsText, scopeText, outOfScopeText, focusAreaText };
  };

  const normalizeRendered = (rendered) => {
    const data = baseScope();
    const policyText = rendered.policyParts
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("\n\n");
    data.program = { name: "", handle: slug, url: canonicalUrl, website: "", about: "" };
    data.capture = {
      source: {
        method: "rendered-page",
        description: "HackenProof rendered program page",
        endpoint: canonicalUrl,
      },
      platformUpdatedAt: {},
    };
    data.guidelines.policy = policyText;
    data.guidelines.scopeDescription = cleanText(rendered.focusAreaText || rendered.scopeText);
    data.guidelines.outOfScopeDescription = cleanText(rendered.outOfScopeText);
    data.rewards.description = cleanText(rendered.rewardsText);
    data.rewards.currency = /\$[\d,]/.test(data.rewards.description) ? "USD" : "";
    data.inScope = rendered.inScope;
    data.outOfScope = rendered.outOfScope;
    // Rendered blocks/prose never become structured rows; only the embedded
    // rewards matrix does.
    return finalize(data, false);
  };

  const main = async () => {
    if (typeof location === "undefined" ||
      location.protocol !== "https:" ||
      (location.hostname !== "hackenproof.com" && location.hostname !== "www.hackenproof.com")) {
      throw new Error("Open a HackenProof program page and try again.");
    }

    // (1a) Live embedded Nuxt state.
    let payload = null;
    let method = "";
    try {
      if (typeof document !== "undefined" && document.querySelector) {
        const el = document.querySelector("#__NUXT_DATA__");
        const raw = cleanText(el?.textContent ?? "");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            payload = parsed;
            method = "embedded-page-data";
          }
        }
      }
    } catch {
      payload = null;
    }

    // (1b) Same-origin refetch: the program URL returns SSR HTML carrying
    // the same __NUXT_DATA__ script. There is no public JSON API (all /api
    // guesses 404); report submission lives behind a dashboard login and is
    // never fetched.
    if (!payload) {
      try {
        const response = await fetch(canonicalUrl, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "text/html" },
        });
        if (response && response.ok) {
          const html = await response.text();
          const match = /<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html || "");
          if (match) {
            const parsed = JSON.parse(match[1]);
            if (parsed && typeof parsed === "object") {
              payload = parsed;
              method = "first-party-api";
            }
          }
        }
      } catch {
        payload = null;
      }
    }

    const embedded = payload ? findProgram(payload) : null;
    if (embedded) {
      return normalizeEmbedded(
        embedded,
        method || "embedded-page-data",
        method === "first-party-api"
          ? "HackenProof program page refetch (same-origin)"
          : "HackenProof program page embedded data",
      );
    }

    // (2) Rendered DOM fallback; always partial without embedded data.
    return normalizeRendered(collectRendered());
  };

  return main()
    .then((data) => ({ ok: true, data }))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Could not extract this HackenProof program's scope.",
    }));
}

function getProgramSlug(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    if (parsed.hostname !== "hackenproof.com" && parsed.hostname !== "www.hackenproof.com") return "";
    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments.length !== 2 || segments[0] !== "programs") return "";
    const slug = segments[1];
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(slug)) return "";
    return slug;
  } catch {
    return "";
  }
}

const hackenproof = {
  id: "hackenproof",
  label: "HackenProof",

  matches(url) {
    return Boolean(getProgramSlug(url));
  },

  async extract(context) {
    const slug = getProgramSlug(context.url);
    if (!slug) {
      throw new Error("Open a HackenProof program page and try again.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      world: "MAIN",
      func: extractHackenProofPage,
      args: [slug],
    });
    const result = results?.[0]?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "Could not extract this HackenProof program's scope.");
    }
    return result.data;
  },
};

export default hackenproof;
