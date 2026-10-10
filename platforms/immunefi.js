// Immunefi platform adapter.
//
// Recon notes (treat as untrusted: the parser below never trusts markup).
// Immunefi program pages are Next.js App Router SSR HTML with no embedded
// JSON and no public JSON API. Each program exposes three sub-pages under
// /bug-bounty/<slug>/: information, scope, and resources. This adapter
// therefore fetches all three pages same-origin in the MAIN world and parses
// them with heading-anchored, table-shape-tolerant DOM walks plus regex fact
// mining over the page text, so unknown class names, reordered sections, or
// renamed columns degrade to partial data instead of silent scope loss.
//
// Privacy: only scope-listed vault/contract addresses are exported. Reporter
// PII is never present on these pages; query strings and fragments are
// stripped from every stored URL, and attachment/link URLs are never stored.

function extractImmunefiPage(slug, subpage, injectedDoc) {
  const cleanText = (value) => {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[\s\u00a0]+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  };

  const capitalize = (value) => {
    const text = cleanText(value).toLowerCase();
    return text ? text[0].toUpperCase() + text.slice(1) : "";
  };

  // "$250,000" -> 250000, "Flat: $25k" -> 25000, "Points" -> null. The
  // trailing-letter guard keeps the "M" of "Min:" from reading as millions.
  const parseAmount = (raw) => {
    const text = cleanText(raw).replace(/\$/g, "").replace(/,/g, "").trim();
    if (!text) return null;
    const match = text.match(/(\d+(?:\.\d+)?)\s*([kKmM])?(?![a-zA-Z])/);
    if (!match) return null;
    let value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    if (match[2]) value *= match[2].toLowerCase() === "k" ? 1000 : 1000000;
    return value;
  };

  // "Registry (Ethereum Mainnet)" -> { name: "Registry", chain: "Ethereum Mainnet" }.
  const splitChainSuffix = (raw) => {
    const text = cleanText(raw);
    const match = text.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!match) return { name: text, chain: "" };
    return { name: cleanText(match[1]) || text, chain: cleanText(match[2]) };
  };

  const findAddress = (raw) => {
    const match = String(raw || "").match(/0x[0-9a-fA-F]{40}/);
    return match ? match[0] : "";
  };

  const SEVERITY_SLOTS = { critical: "critical", high: "high", medium: "medium", low: "low" };

  // ---- Minimal HTML fallback -------------------------------------------
  // Used when DOMParser is unavailable (e.g. under test in Node). Supports
  // only the query surface this adapter uses: tables/rows/cells, links,
  // headings, paragraphs, and list items. Real DOM nodes satisfy the same
  // surface, so both paths converge on the section/table parsers below.
  const stripTags = (html) => cleanText(String(html ?? "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#124;/gi, "|"));

  const parseAttrs = (tagText) => {
    const attrs = {};
    const re = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = re.exec(tagText || ""))) {
      attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
    }
    return attrs;
  };

  const SELECTOR_TAGS = {
    table: ["table"], tr: ["tr"], th: ["th"], td: ["td"],
    a: ["a"], p: ["p"], li: ["li"], ul: ["ul"], ol: ["ol"],
    h1: ["h1"], h2: ["h2"], h3: ["h3"], h4: ["h4"], h5: ["h5"], h6: ["h6"],
  };

  const resolveSelector = (selector) => String(selector || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .flatMap((part) => SELECTOR_TAGS[part] || []);

  const extractTags = (html, tags) => {
    const source = String(html ?? "");
    const found = [];
    for (const tag of tags) {
      const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
      let match;
      while ((match = re.exec(source))) {
        found.push({ tag, attrs: parseAttrs(match[1]), inner: match[2], index: match.index });
      }
    }
    found.sort((a, b) => a.index - b.index);
    return found;
  };

  const makeMiniNode = (tag, inner, attrs) => ({
    tagName: String(tag).toUpperCase(),
    innerText: stripTags(inner),
    textContent: stripTags(inner),
    getAttribute: (name) => {
      const value = attrs[String(name).toLowerCase()];
      return value === undefined ? null : value;
    },
    querySelectorAll: (selector) => makeMiniNodes(inner, resolveSelector(selector)),
    querySelector: (selector) => makeMiniNodes(inner, resolveSelector(selector))[0] || null,
  });

  const makeMiniNodes = (html, tags) =>
    extractTags(html, tags).map((hit) => makeMiniNode(hit.tag, hit.inner, hit.attrs));

  const makeMiniRoot = (html) => ({
    querySelectorAll: (selector) => makeMiniNodes(html, resolveSelector(selector)),
    querySelector: (selector) => makeMiniNodes(html, resolveSelector(selector))[0] || null,
  });

  const parseHtml = (html) => {
    const source = String(html ?? "");
    try {
      if (typeof DOMParser !== "undefined") {
        const doc = new DOMParser().parseFromString(source, "text/html");
        if (doc) return doc;
      }
    } catch {
      // Fall through to the regex fallback below.
    }
    return makeMiniRoot(source);
  };

  // ---- DOM helpers (real DOM and mini-DOM share this surface) -----------
  const cellText = (cell) => cleanText(cell?.innerText ?? cell?.textContent ?? "");

  const linksIn = (node) => {
    let anchors = [];
    try {
      anchors = Array.from(node?.querySelectorAll ? node.querySelectorAll("a") : []);
    } catch {
      anchors = [];
    }
    return anchors.map((anchor) => {
      let href = "";
      try {
        href = cleanText(anchor.getAttribute ? anchor.getAttribute("href") : anchor.href);
      } catch {
        href = "";
      }
      return { href, text: cellText(anchor) };
    });
  };

  const rowsOf = (table) => {
    try {
      return Array.from(table?.querySelectorAll ? table.querySelectorAll("tr") : []);
    } catch {
      return [];
    }
  };

  const cellsOf = (row) => {
    try {
      return Array.from(row?.querySelectorAll ? row.querySelectorAll("th, td") : []);
    } catch {
      return [];
    }
  };

  const hasHeaderCells = (row) => {
    try {
      return (row?.querySelectorAll ? row.querySelectorAll("th") : []).length > 0;
    } catch {
      return false;
    }
  };

  // ---- Section walk ------------------------------------------------------
  // Single ordered walk over headings, tables, lists, and paragraphs so
  // every table is attributed to its nearest preceding heading. Unknown
  // headings are kept verbatim as group names; only the classification
  // regexes below decide what a section means.
  const collectSections = (root) => {
    let nodes = [];
    try {
      nodes = Array.from(
        root?.querySelectorAll ? root.querySelectorAll("h1, h2, h3, h4, table, ul, ol, p") : [],
      );
    } catch {
      nodes = [];
    }
    const sections = [{ heading: "", level: 0, nodes: [], context: "" }];
    let currentH3 = "";
    let currentH4 = "";
    for (const node of nodes) {
      const tag = String(node?.tagName || "").toUpperCase();
      if (/^H[1-4]$/.test(tag)) {
        const text = cellText(node);
        if (!text) continue;
        if (tag === "H3") {
          currentH3 = text;
          currentH4 = "";
        } else if (tag === "H4") {
          currentH4 = text;
        }
        sections.push({
          heading: text,
          level: Number(tag.slice(1)),
          nodes: [],
          context: currentH4 || currentH3,
        });
        continue;
      }
      sections[sections.length - 1].nodes.push(node);
    }
    return sections;
  };

  const sectionText = (section) => {
    const parts = [];
    for (const node of section.nodes || []) {
      const tag = String(node?.tagName || "").toUpperCase();
      if (tag === "P") {
        const text = cellText(node);
        if (text) parts.push(text);
      } else if (tag === "UL" || tag === "OL") {
        let items = [];
        try {
          items = Array.from(node?.querySelectorAll ? node.querySelectorAll("li") : []);
        } catch {
          items = [];
        }
        for (const item of items) {
          const text = cellText(item);
          if (text) parts.push(text);
        }
      }
    }
    return parts.join("\n");
  };

  const sectionTables = (section) =>
    (section.nodes || []).filter((node) => String(node?.tagName || "").toUpperCase() === "TABLE");

  const sectionsText = (sections) =>
    sections.map((section) => cleanText(`${section.heading}\n${sectionText(section)}`))
      .filter(Boolean)
      .join("\n\n");

  // ---- Table shapes -------------------------------------------------------
  const tableToRows = (table) => {
    const rows = rowsOf(table);
    if (rows.length === 0) return null;
    const firstCells = cellsOf(rows[0]).map(cellText);
    const headText = firstCells.join(" | ").toLowerCase();
    const looksLikeHeader = /(target|name|type|funds|added|severity|title|auditor|link|completed|categor|description|updated|track|payout|max|min|flat|reward|document)/.test(headText);
    const headerRow = hasHeaderCells(rows[0]) || (looksLikeHeader && rows.length > 1);
    const headers = headerRow ? firstCells.map((cell) => cell.toLowerCase()) : [];
    const body = (headerRow ? rows.slice(1) : rows).map((row) => {
      const cells = cellsOf(row);
      return cells.map((cell) => ({ text: cellText(cell), links: linksIn(cell) }));
    }).filter((cells) => cells.length > 0 && cells.some((cell) => cell.text || cell.links.length > 0));
    if (headers.length === 0 && body.length === 0) return null;
    return { headers, rows: body };
  };

  const columnIndex = (headers, ...terms) =>
    headers.findIndex((header) => terms.some((term) => header.includes(term)));

  const headerIncludes = (headers, ...terms) => columnIndex(headers, ...terms) >= 0;

  const isAuditTable = (parsed) =>
    headerIncludes(parsed.headers, "auditor") || headerIncludes(parsed.headers, "completed");

  const isKnownIssueTable = (parsed) =>
    headerIncludes(parsed.headers, "categor") && headerIncludes(parsed.headers, "description");

  const isCodeTable = (parsed) =>
    headerIncludes(parsed.headers, "link") &&
    (headerIncludes(parsed.headers, "title") || headerIncludes(parsed.headers, "description")) &&
    !headerIncludes(parsed.headers, "auditor") &&
    !headerIncludes(parsed.headers, "target");

  const isAssetTable = (parsed) =>
    headerIncludes(parsed.headers, "target") ||
    (headerIncludes(parsed.headers, "name") &&
      (headerIncludes(parsed.headers, "type") ||
        headerIncludes(parsed.headers, "funds") ||
        headerIncludes(parsed.headers, "added") ||
        headerIncludes(parsed.headers, "address") ||
        headerIncludes(parsed.headers, "chain")));

  const tableMentionsSeverity = (parsed) =>
    parsed.rows.some((cells) => /\b(critical|high|medium|low)\b/i.test(cells.map((cell) => cell.text).join(" | ")));

  const tableMentionsMoney = (parsed) =>
    parsed.rows.some((cells) => /\$[\d,]/.test(cells.map((cell) => cell.text).join(" | ")));

  const isRewardTable = (parsed) =>
    (headerIncludes(parsed.headers, "max") ||
      headerIncludes(parsed.headers, "min") ||
      headerIncludes(parsed.headers, "flat") ||
      headerIncludes(parsed.headers, "payout") ||
      headerIncludes(parsed.headers, "reward")) &&
    (tableMentionsSeverity(parsed) || tableMentionsMoney(parsed));

  const isImpactTable = (parsed) =>
    headerIncludes(parsed.headers, "severity") &&
    (headerIncludes(parsed.headers, "title") || headerIncludes(parsed.headers, "impact")) &&
    !tableMentionsMoney(parsed);

  // ---- Row parsers ----------------------------------------------------------
  const parseRewardRow = (cells) => {
    const joined = cells.map((cell) => cell.text).join(" | ");
    const severityMatch = joined.match(/\b(critical|high|medium|low)\b/i);
    if (!severityMatch) return null;
    const severity = severityMatch[1].toLowerCase();
    const amounts = [...joined.matchAll(/\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z])/g)]
      .map((match) => parseAmount(match[0]))
      .filter((value) => value !== null);
    let min = null;
    let max = null;
    if (/flat/i.test(joined)) {
      if (amounts.length > 0) min = max = amounts[0];
    } else {
      const maxMatch = joined.match(/max[^$]{0,24}(\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z]))/i);
      const minMatch = joined.match(/min[^$]{0,24}(\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z]))/i);
      if (maxMatch) max = parseAmount(maxMatch[1]);
      if (minMatch) min = parseAmount(minMatch[1]);
      if (max === null && min === null && amounts.length === 1) {
        min = max = amounts[0];
      } else if (max === null && min === null && amounts.length >= 2) {
        min = Math.min(...amounts);
        max = Math.max(...amounts);
      } else if (max === null) {
        max = min;
      } else if (min === null) {
        min = max;
      }
    }
    if (max === null && min === null) return null;
    return {
      severity,
      min,
      max,
      primacy: /primacy of impact/i.test(joined) ? "Primacy of Impact" : "",
    };
  };

  const trackNameFor = (section) => {
    const candidate = cleanText(section.context || "");
    if (!candidate || /reward|threat level|payout|bounty|program|overview/i.test(candidate)) return "General";
    return candidate;
  };

  // Track reward blocks render as text, not tables ("Smart Contract
  // Critical Max: $250,000 Min: $50,000 Primacy of Impact"). Parse each
  // "<Track> <Severity> [Max: $X] [Min: $Y] [Flat: $Z]" run generally.
  const parseRewardBlocks = (text) => {
    const rows = [];
    const pattern = /(smart contract|blockchain(?:\/dlt)?|websites?(?:\s+(?:and|&)\s+app(?:lication)?s?)?|web(?:\s*(?:&|and)\s*app)?)\s+(critical|high|medium|low)\s+((?:(?:max|min|flat)\s*:\s*\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z])\s*)+)(primacy of (?:impact|rules))?/gi;
    let match;
    while ((match = pattern.exec(cleanText(text)))) {
      const track = match[1].replace(/\s+/g, " ").trim();
      const severity = match[2].toLowerCase();
      const amounts = match[3] || "";
      const flat = /flat\s*:\s*(\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z]))/i.exec(amounts);
      const maxM = /max\s*:\s*(\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z]))/i.exec(amounts);
      const minM = /min\s*:\s*(\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z]))/i.exec(amounts);
      let min = null;
      let max = null;
      if (flat) {
        min = max = parseAmount(flat[1]);
      } else {
        if (maxM) max = parseAmount(maxM[1]);
        if (minM) min = parseAmount(minM[1]);
      }
      if (max === null && min === null) continue;
      if (max === null) max = min;
      if (min === null) min = max;
      rows.push({
        track: track.split(/\s+/).map((word) =>
          /^(and|&|of)$/i.test(word) ? word.toLowerCase()
            : word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" "),
        severity,
        min,
        max,
        primacy: /primacy of impact/i.test(match[4] || "") ? "Primacy of Impact"
          : /primacy of rules/i.test(match[4] || "") ? "Primacy of Rules" : "",
      });
      if (rows.length >= 40) break;
    }
    return rows;
  };

  const groupNameFor = (section, fallback) => {
    const heading = cleanText(section.heading || "");
    if (!heading || /assets?\s+in\s+scope|^scope$|in-?scope/i.test(heading)) return fallback;
    return heading;
  };

  const parseAssetTable = (parsed, section) => {
    const targetCol = columnIndex(parsed.headers, "target", "address", "contract");
    const nameCol = columnIndex(parsed.headers, "name");
    const typeCol = columnIndex(parsed.headers, "type");
    const fundsCol = columnIndex(parsed.headers, "funds");
    const addedCol = columnIndex(parsed.headers, "added");
    const chainCol = columnIndex(parsed.headers, "chain", "network");
    const assets = [];
    for (const cells of parsed.rows) {
      const at = (index) => (index >= 0 && index < cells.length ? cells[index] : { text: "", links: [] });
      const targetCell = at(targetCol >= 0 ? targetCol : nameCol >= 0 ? nameCol : 0);
      const nameCell = at(nameCol >= 0 ? nameCol : targetCol >= 0 ? targetCol : 0);
      let address = "";
      for (const link of targetCell.links) {
        address = findAddress(link.href);
        if (address) break;
      }
      if (!address) address = findAddress(targetCell.text);
      const split = splitChainSuffix(nameCell.text);
      let chain = split.chain;
      if (!chain && chainCol >= 0) chain = cleanText(at(chainCol).text);
      // Display cell is "0xDD9B...a4E1 etherscan.io" chrome: the human name
      // is the asset, the full address rides in `address`.
      let asset = cleanText(targetCell.text).replace(/\s*etherscan\.io\s*$/i, "").trim() || split.name;
      if (/^0x[0-9a-f]+\.\.\.[0-9a-f]+$/i.test(asset) && split.name &&
        !/^0x[0-9a-f]+\.\.\.[0-9a-f]+$/i.test(split.name)) {
        asset = split.name;
      }
      if (!asset) continue;
      const notes = [];
      const funds = fundsCol >= 0 ? cleanText(at(fundsCol).text) : "";
      const added = addedCol >= 0 ? cleanText(at(addedCol).text) : "";
      if (funds) notes.push(`Funds: ${funds}`);
      if (added) notes.push(`Added on: ${added}`);
      // Display cell carries "0xDD9B...a4E1 etherscan.io" chrome: keep the
      // human name only when it adds information beyond the truncated hash.
      const rawDisplay = cleanText(targetCell.text).replace(/\s*etherscan\.io\s*$/i, "").trim();
      if (split.name && rawDisplay && split.name !== rawDisplay &&
        !/^0x[0-9a-f]+\.\.\.[0-9a-f]+$/i.test(rawDisplay)) {
        notes.push(split.name);
      }
      assets.push({
        asset,
        address,
        chain,
        type: typeCol >= 0 ? cleanText(at(typeCol).text) : "",
        group: groupNameFor(section, "Assets in Scope"),
        instruction: notes.join("; "),
      });
    }
    return assets;
  };

  const parseImpactTable = (parsed) => {
    const sevCol = columnIndex(parsed.headers, "severity");
    const titleCol = columnIndex(parsed.headers, "title", "impact");
    const descCol = columnIndex(parsed.headers, "description", "detail");
    const impacts = [];
    for (const cells of parsed.rows) {
      const at = (index) => (index >= 0 && index < cells.length ? cells[index].text : "");
      const severity = capitalize(at(sevCol >= 0 ? sevCol : 0));
      const title = cleanText(at(titleCol >= 0 ? titleCol : 1));
      if (!title || !/^(critical|high|medium|low)$/i.test(severity)) continue;
      impacts.push({
        severity,
        title,
        description: descCol >= 0 ? cleanText(at(descCol)) : "",
      });
    }
    return impacts;
  };

  // Live scope pages render impacts as Severity+Title text pairs ("Critical
  // <title>" lines), single-line runs ("Critical <title>"), and 2-col
  // tables. All three are paired generally.
  const parseImpactPairs = (text) => {
    const impacts = [];
    const lines = cleanText(text).split("\n").map(cleanText).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      // Single-line run: "Critical Direct theft of user funds".
      const single = /^(Critical|High|Medium|Low)\s+(.{8,300})$/.exec(lines[i]);
      if (single && !/^(Critical|High|Medium|Low)$/i.test(single[2]) &&
        !/^view rewards?|^submit|^show all|^\d[\d\s]*$/.test(single[2])) {
        impacts.push({ severity: capitalize(single[1]), title: cleanText(single[2]), description: "" });
        continue;
      }
      // Two-line pair: "Critical" then "<title>".
      if (i >= lines.length - 1) continue;
      const severity = capitalize(lines[i]);
      if (!/^(Critical|High|Medium|Low)$/.test(severity)) continue;
      const title = lines[i + 1];
      if (!title || /^(Critical|High|Medium|Low)$/i.test(title)) continue;
      if (/^view rewards?|^submit|^show all|^\d[\d\s]*$/.test(title)) continue;
      impacts.push({ severity, title, description: "" });
      i += 1;
    }
    return impacts;
  };

  const parseAuditEntries = (parsed) => {
    const auditorCol = columnIndex(parsed.headers, "auditor", "firm", "company");
    const completedCol = columnIndex(parsed.headers, "completed", "date");
    const entries = [];
    for (const cells of parsed.rows) {
      const at = (index) => (index >= 0 && index < cells.length ? cells[index].text : "");
      const auditor = cleanText(at(auditorCol >= 0 ? auditorCol : 0));
      if (!auditor) continue;
      entries.push({
        auditor,
        completedAt: completedCol >= 0 ? cleanText(at(completedCol)) : "",
      });
    }
    return entries;
  };

  const parseKnownIssueRows = (parsed) => {
    // Recon: Known Issues table columns are Category|Description/Link|Last
    // Updated At. Only non-sensitive dedupe fields are kept: title,
    // priority, state, target. Dates, links, and identifiers are dropped.
    const categoryCol = columnIndex(parsed.headers, "categor", "severity", "priority");
    const descCol = columnIndex(parsed.headers, "description", "title", "issue", "link");
    const items = [];
    for (const cells of parsed.rows) {
      const at = (index) => (index >= 0 && index < cells.length ? cells[index] : { text: "", links: [] });
      const descCell = at(descCol >= 0 ? descCol : 0);
      const title = cleanText(descCell.links.find((link) => link.text)?.text || descCell.text);
      if (!title) continue;
      items.push({
        title,
        priority: categoryCol >= 0 ? cleanText(at(categoryCol).text) : "",
        state: "",
        target: "",
      });
      if (items.length >= 500) break;
    }
    return items;
  };

  const parseCodeRows = (parsed, section) => {
    // Codebase/Documentation tables: Title|Description|Link. The link label
    // becomes the attachment fileName; hrefs (which can carry tokens or
    // session material) are never stored.
    const titleCol = columnIndex(parsed.headers, "title", "name", "repo");
    const linkCol = columnIndex(parsed.headers, "link", "url", "repo");
    const items = [];
    for (const cells of parsed.rows) {
      const at = (index) => (index >= 0 && index < cells.length ? cells[index] : { text: "", links: [] });
      const titleCell = at(titleCol >= 0 ? titleCol : 0);
      const linkCell = at(linkCol >= 0 ? linkCol : cells.length - 1);
      const fileName = cleanText(linkCell.links.find((link) => link.text)?.text || "") ||
        cleanText(linkCell.text) ||
        cleanText(titleCell.text);
      if (!fileName) continue;
      items.push({
        section: cleanText(section.heading || "") || "Resources",
        fileName,
        fileSize: null,
        contentType: "",
      });
    }
    return items;
  };

  const allLinks = (root) => {
    let anchors = [];
    try {
      anchors = Array.from(root?.querySelectorAll ? root.querySelectorAll("a") : []);
    } catch {
      anchors = [];
    }
    return anchors.map((anchor) => {
      let href = "";
      try {
        href = cleanText(anchor.getAttribute ? anchor.getAttribute("href") : anchor.href);
      } catch {
        href = "";
      }
      return { href, text: cellText(anchor) };
    });
  };

  // First http(s) link outside Immunefi's own hosts and common social
  // profiles. Query and fragment are dropped (utm/session material).
  const findProjectUrl = (root) => {
    const social = /^(www\.)?(twitter\.com|x\.com|discord\.gg|discord\.com|t\.me|telegram\.me|medium\.com|youtube\.com|youtu\.be|linkedin\.com|facebook\.com|instagram\.com)$/i;
    for (const link of allLinks(root)) {
      const raw = link.href;
      if (!/^https?:\/\//i.test(raw)) continue;
      let host = "";
      try {
        host = new URL(raw).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (host === "immunefi.com" || host === "www.immunefi.com" || host === "bugs.immunefi.com") continue;
      if (social.test(host)) continue;
      return raw.split("?")[0].split("#")[0].replace(/\/+$/, "") || raw;
    }
    return "";
  };

  const firstH1 = (sections) => {
    for (const section of sections) {
      if (section.level === 1 && cleanText(section.heading)) return cleanText(section.heading);
    }
    return "";
  };

  const firstLineMatch = (text, pattern) => {
    const match = pattern.exec(text);
    return match ? cleanText(match[1] !== undefined ? match[1] : match[0]) : "";
  };

  const sectionByHeading = (sections, pattern) =>
    sections.filter((section) => pattern.test(section.heading || ""));

  // Fact mining is scoped to the header region: everything up to the first
  // section boundary (tab nav, vault box end, rewards heading). Whole-page
  // mining drags nav/footer/rewards text into scalar metadata fields;
  // first-N-lines breaks on long headers. Boundaries are structural.
  const headerRegion = (minedText) => {
    const lines = cleanText(minedText).split("\n");
    const boundary = /^(information|scope|resources|submit a bug|immunefi vault program|rewards(\s+by\s+threat)?|program overview|tags?)$/i;
    const out = [];
    for (const line of lines) {
      if (out.length >= 8 && boundary.test(line)) break;
      out.push(line);
      if (out.length >= 120) break;
    }
    return out.join("\n");
  };

  // Scalar values end at the first boundary: a date stays a date, an
  // amount stays an amount. Live headers concatenate without newlines, so
  // first-line mining drags the vault/rewards/nav text into every field.
  const scalarValue = (raw, pattern) => {
    const match = pattern.exec(cleanText(raw));
    if (!match) return "";
    return cleanText(match[1] !== undefined ? match[1] : match[0]);
  };

  const mineProgramFacts = (sections, minedText) => {
    const header = headerRegion(minedText);
    const maxBounty = scalarValue(header, /Maximum Bounty\s*:?\s*(\$[\d,]+(?:\.\d+)?\s*[kKmM]?(?![a-zA-Z]))/i);
    const liveSince = scalarValue(header, /Live Since\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/i);
    const lastUpdated = scalarValue(header, /Last Updated\s*:?\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?|\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/i);
    let kycRequired = null;
    if (/kyc[\s\S]{0,80}?not\s+required/i.test(minedText)) kycRequired = false;
    else if (/kyc[\s\S]{0,80}?required/i.test(minedText)) kycRequired = true;
    let pocRequired = null;
    if (/\bpoc\b[\s\S]{0,60}?not\s+required/i.test(minedText)) pocRequired = false;
    else if (/\bpoc\b[\s\S]{0,60}?required/i.test(minedText) || /proof of concept[\s\S]{0,60}?required/i.test(minedText)) {
      pocRequired = true;
    }
    const tagSections = sectionByHeading(sections, /^\s*tags?\s*$/i);
    const tags = [];
    for (const section of tagSections) {
      for (const line of sectionText(section).split("\n")) {
        for (const part of line.split(/[,;|]/)) {
          const tag = cleanText(part);
          if (tag && !tags.includes(tag)) tags.push(tag);
        }
      }
    }
    return { maxBounty, liveSince, lastUpdated, kycRequired, pocRequired, tags };
  };

  // Vault label→value pairing: "Funds available\n$425,757.57" pairs
  // adjacent lines instead of first-matching a label anywhere. Whole-block
  // mining swaps labels and values ("Average30d: Assets in vault").
  const vaultPair = (lines, ...labelPatterns) => {
    const inlineValue = (line) => {
      // "Funds available: $1,000,000" or "Funds available $1,000,000".
      const match = /:\s*(.+)$/.exec(line) || /\s{2,}(.+)$/.exec(line);
      if (match && cleanText(match[1])) return cleanText(match[1]);
      // "Label value" on one line: strip the label words, keep the rest.
      for (const pattern of labelPatterns) {
        const stripped = cleanText(line.replace(pattern, ""));
        if (stripped && stripped !== cleanText(line)) return stripped;
      }
      return "";
    };
    for (let i = 0; i < lines.length; i += 1) {
      if (!labelPatterns.some((pattern) => pattern.test(lines[i]))) continue;
      const inline = inlineValue(lines[i]);
      if (inline && !/^(funds|assets|30-?d|average|public vault|rewards|submit|information|scope|resources)/i.test(inline)) {
        return inline;
      }
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
        const candidate = cleanText(lines[j]);
        if (!candidate) continue;
        // A value line is not another label.
        if (/^(funds|assets|30-?d|average|public vault|rewards|submit|information|scope|resources)/i.test(candidate)) {
          break;
        }
        return candidate;
      }
    }
    return "";
  };

  const mineVault = (sections, minedText) => {
    const vaultSections = sectionByHeading(sections, /vault|funds/i);
    const vaultText = vaultSections.map(sectionText).join("\n") || minedText;
    const lines = cleanText(vaultText).split("\n").map(cleanText).filter(Boolean);
    let address = "";
    const nearVault = minedText.match(/vault[\s\S]{0,400}(0x[0-9a-fA-F]{40})/i) ||
      minedText.match(/(0x[0-9a-fA-F]{40})[\s\S]{0,120}vault/i);
    if (nearVault) {
      address = nearVault[1];
    } else {
      const inSection = vaultText.match(/0x[0-9a-fA-F]{40}/);
      if (inSection) address = inSection[0];
    }
    return {
      fundsAvailable: vaultPair(lines, /^funds(?:\s+available)?\b/i),
      average30d: vaultPair(lines, /^30-?d\s+avg/i, /funds availability/i),
      assetsInVault: vaultPair(lines, /^assets in vault\b/i),
      address,
    };
  };

  // ---- Sub-page parsers -----------------------------------------------------
  const parseInformation = (root, rawHtml) => {
    const sections = collectSections(root);
    const minedText = cleanText(rawHtml ? stripTags(rawHtml) : sectionsText(sections));
    const facts = mineProgramFacts(sections, minedText);
    const vault = mineVault(sections, minedText);

    const name = firstH1(sections) ||
      firstLineMatch(String(rawHtml || ""), /<title[^>]*>([^<]*)<\/title>/i).split("|")[0].trim() ||
      "";
    const website = root ? findProjectUrl(root) : "";
    const overviewSections = sectionByHeading(sections, /program overview|about|description/i);
    let about = overviewSections.map(sectionText).join("\n\n").trim();
    if (!about) {
      for (const section of sections) {
        const text = sectionText(section);
        const longPara = text.split("\n").find((line) => line.length >= 60);
        if (longPara) {
          about = longPara;
          break;
        }
      }
    }

    const policyParts = [];
    if (about && overviewSections.length > 0) policyParts.push(about);
    const rewardProse = sectionByHeading(sections, /reward/i)
      .map(sectionText).join("\n\n").trim();
    if (rewardProse) policyParts.push(rewardProse);

    const consumed = /audit|known issues?|rewards?|threat level|program overview|about|description|tags?|vault|funds|kyc|proof of concept|\bpoc\b|publication|prohibit|feasibility|bounty|live since|last updated|maximum/i;
    for (const section of sections) {
      if (!section.heading || consumed.test(section.heading)) continue;
      const text = sectionText(section);
      if (text) policyParts.push(`${section.heading}\n${text}`);
    }

    const pushRewardRow = (rewardRows, track, row) => {
      if (!row || !SEVERITY_SLOTS[row.severity]) return;
      const slot = SEVERITY_SLOTS[row.severity];
      const amounts = {};
      if (slot === "critical") {
        amounts.critical = row.max;
        amounts.criticalMinimum = row.min;
      } else if (slot === "high") {
        amounts.high = row.max;
        amounts.highMinimum = row.min;
      } else if (slot === "medium") {
        amounts.medium = row.max;
        amounts.mediumMinimum = row.min;
      } else {
        amounts.low = row.max;
        amounts.lowMinimum = row.min;
      }
      const name = `${track} — ${capitalize(row.severity)}`;
      if (rewardRows.some((existing) => existing.name === name)) return;
      rewardRows.push({
        name,
        asset: "",
        useRange: row.min !== null && row.max !== null && row.min !== row.max,
        amounts,
        ...(row.primacy ? { primacy: row.primacy } : {}),
      });
    };

    const rewardRows = [];
    for (const section of sections) {
      for (const table of sectionTables(section)) {
        const parsed = tableToRows(table);
        if (!parsed) continue;
        if (!isRewardTable(parsed) && !/rewards? by threat|threat level/i.test(section.heading || "")) continue;
        const track = trackNameFor(section);
        for (const cells of parsed.rows) {
          pushRewardRow(rewardRows, track, parseRewardRow(cells));
        }
      }
      // Text-block rewards ("Smart Contract Critical Max: $X Min: $Y"):
      // same rows, no table required.
      if (/rewards? by threat|threat level|rewards?/i.test(section.heading || "")) {
        for (const row of parseRewardBlocks(sectionText(section))) {
          pushRewardRow(rewardRows, row.track || trackNameFor(section), row);
        }
      }
    }

    const audits = [];
    for (const section of sections) {
      for (const table of sectionTables(section)) {
        const parsed = tableToRows(table);
        if (!parsed || !isAuditTable(parsed)) continue;
        audits.push(...parseAuditEntries(parsed));
      }
    }
    if (audits.length > 0) {
      policyParts.push(`Audits:\n${audits.map((audit) =>
        `- ${audit.auditor}${audit.completedAt ? ` (${audit.completedAt})` : ""}`).join("\n")}`);
    }

    const knownIssues = [];
    for (const section of sections) {
      if (!/known issues?/i.test(section.heading || "")) continue;
      for (const table of sectionTables(section)) {
        const parsed = tableToRows(table);
        if (!parsed) continue;
        knownIssues.push(...parseKnownIssueRows(parsed));
      }
    }

    const pocSections = sectionByHeading(sections, /proof of concept|\bpoc\b/i).map(sectionText).join("\n").trim();
    const kycSections = sectionByHeading(sections, /\bkyc\b/i).map(sectionText).join("\n").trim();
    const publicationSections = sectionByHeading(sections, /responsible publication|publication/i).map(sectionText).join("\n").trim();
    const severitySections = sectionByHeading(sections, /prohibit|feasibility|severity/i).map((section) =>
      `${section.heading}\n${sectionText(section)}`.trim()).join("\n\n").trim();
    if (pocSections) policyParts.push(pocSections);
    if (kycSections) policyParts.push(kycSections);
    if (publicationSections) policyParts.push(`Responsible Publication\n${publicationSections}`);

    const publicationCategory = firstLineMatch(minedText, /Responsible Publication\s*:?\s*([^\n]+)/i) ||
      cleanText(publicationSections).split("\n")[0];

    return {
      name, website, about, policyParts, rewardRows, rewardProse, audits, knownIssues,
      facts, vault, pocSections, kycSections, severitySections, publicationCategory,
    };
  };

  const parseScope = (root, rawHtml) => {
    const sections = collectSections(root);
    const assets = [];
    const impacts = [];
    const outOfScope = [];
    const outOfScopeParts = [];
    let impactsBody = "";

    for (const section of sections) {
      const heading = section.heading || "";
      const isOutSection = /out[\s-]?of[\s-]?scope/i.test(heading);
      for (const table of sectionTables(section)) {
        const parsed = tableToRows(table);
        if (!parsed) continue;
        if (!isOutSection && isAssetTable(parsed)) {
          assets.push(...parseAssetTable(parsed, section));
          continue;
        }
        if (!isOutSection && isImpactTable(parsed)) {
          impacts.push(...parseImpactTable(parsed));
          continue;
        }
        if (!isOutSection && isRewardTable(parsed)) continue;
      }
      const text = sectionText(section);
      if (/impacts? (in scope|body)|impacts?$/i.test(heading) || (/impact/i.test(heading) && !isOutSection)) {
        if (text) {
          impactsBody = cleanText(`${impactsBody}\n${text}`);
          // Text-pair impacts ("Critical\n<title>") never reach a table.
          impacts.push(...parseImpactPairs(text));
        }
      }
      if (isOutSection) {
        if (text) {
          outOfScopeParts.push(`${heading}\n${text}`.trim());
          for (const line of text.split("\n")) {
            const item = cleanText(line);
            if (item) outOfScope.push({ asset: item, type: "", group: heading || "Out of Scope", instruction: "" });
          }
        }
      }
    }

    return { assets, impacts, impactsBody, outOfScope, outOfScopeParts };
  };

  const parseResources = (root) => {
    const sections = collectSections(root);
    const attachments = [];
    const assetNotes = [];
    for (const section of sections) {
      for (const table of sectionTables(section)) {
        const parsed = tableToRows(table);
        if (!parsed || !isCodeTable(parsed)) continue;
        attachments.push(...parseCodeRows(parsed, section));
      }
      if (/assets?(\s+body)?$/i.test(section.heading || "") || /documentation/i.test(section.heading || "")) {
        const text = sectionText(section);
        if (text) assetNotes.push(`${section.heading}\n${text}`.trim());
      }
    }
    return { attachments, assetNotes };
  };

  // ---- Merge ------------------------------------------------------------------
  const dedupeBy = (items, keyFn) => {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const key = keyFn(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  const assetKey = (entry) => {
    const address = cleanText(entry?.address).toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(address)) return `addr:${address}`;
    return `name:${cleanText(entry?.asset).toLowerCase()}|${cleanText(entry?.chain).toLowerCase()}`;
  };

  // ---- Main ---------------------------------------------------------------------
  const main = async () => {
    const loc = typeof location !== "undefined" ? location : null;
    if (!loc || loc.protocol !== "https:" ||
      (loc.hostname !== "immunefi.com" && loc.hostname !== "www.immunefi.com")) {
      throw new Error("Open an Immunefi bug bounty program page and try again.");
    }
    const origin = loc.origin || "https://immunefi.com";
    const base = `${origin}/bug-bounty/${encodeURIComponent(slug)}`;
    const canonical = `https://immunefi.com/bug-bounty/${encodeURIComponent(slug)}/information/`;
    const urls = {
      information: `${base}/information/`,
      scope: `${base}/scope/`,
      resources: `${base}/resources/`,
    };

    const notes = [];
    const pages = {};
    for (const key of Object.keys(urls)) {
      try {
        const response = await fetch(urls[key], {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "text/html" },
        });
        if (!response || !response.ok) {
          notes.push(`Partial export: the Immunefi ${key} page could not be retrieved (HTTP ${response?.status ?? "error"}), so its content is missing below.`);
          pages[key] = "";
          continue;
        }
        pages[key] = await response.text();
      } catch {
        notes.push(`Partial export: the Immunefi ${key} page could not be retrieved (network error), so its content is missing below.`);
        pages[key] = "";
      }
    }

    const info = parseInformation(pages.information ? parseHtml(pages.information) : null, pages.information || "");
    const scope = parseScope(pages.scope ? parseHtml(pages.scope) : null, pages.scope || "");
    const resources = parseResources(pages.resources ? parseHtml(pages.resources) : null);

    // The live tab supplements whatever the fetches missed (e.g. when a
    // sub-page fetch is blocked, the visible page still yields its section).
    try {
      const liveRoot = injectedDoc ||
        (typeof document !== "undefined" ? document : null);
      const liveHtml = liveRoot?.documentElement?.outerHTML || "";
      const page = subpage === "scope" ? "scope" : subpage === "resources" ? "resources" : "information";
      if (liveRoot && (liveHtml || (liveRoot.querySelectorAll && liveRoot.querySelectorAll("h1, h2, h3, h4, table, ul, ol, p").length > 0))) {
        if (page === "scope") {
          const live = parseScope(liveRoot, liveHtml);
          scope.assets.push(...live.assets);
          scope.impacts.push(...live.impacts);
          scope.outOfScope.push(...live.outOfScope);
          scope.outOfScopeParts.push(...live.outOfScopeParts);
          if (!scope.impactsBody && live.impactsBody) scope.impactsBody = live.impactsBody;
        } else if (page === "resources") {
          const live = parseResources(liveRoot);
          resources.attachments.push(...live.attachments);
          resources.assetNotes.push(...live.assetNotes);
        } else {
          const live = parseInformation(liveRoot, liveHtml);
          if (!info.name && live.name) info.name = live.name;
          if (!info.website && live.website) info.website = live.website;
          if (!info.about && live.about) info.about = live.about;
          info.policyParts.push(...live.policyParts);
          info.rewardRows.push(...live.rewardRows);
          if (!info.rewardProse && live.rewardProse) info.rewardProse = live.rewardProse;
          info.audits.push(...live.audits);
          info.knownIssues.push(...live.knownIssues);
          for (const key of ["maxBounty", "liveSince", "lastUpdated"]) {
            if (!info.facts[key] && live.facts[key]) info.facts[key] = live.facts[key];
          }
          if (info.facts.tags.length === 0) info.facts.tags.push(...live.facts.tags);
          if (info.facts.kycRequired === null) info.facts.kycRequired = live.facts.kycRequired;
          if (info.facts.pocRequired === null) info.facts.pocRequired = live.facts.pocRequired;
          for (const key of ["fundsAvailable", "average30d", "assetsInVault", "address"]) {
            if (!info.vault[key] && live.vault[key]) info.vault[key] = live.vault[key];
          }
          if (!info.publicationCategory && live.publicationCategory) {
            info.publicationCategory = live.publicationCategory;
          }
          if (!info.severitySections && live.severitySections) {
            info.severitySections = live.severitySections;
          }
        }
      }
    } catch {
      // The live document is a supplement; fetch results stand on their own.
    }

    const inScope = dedupeBy(scope.assets, assetKey);
    const impacts = dedupeBy(scope.impacts, (item) =>
      `${cleanText(item.severity).toLowerCase()}|${cleanText(item.title).toLowerCase()}`);
    const knownIssues = dedupeBy(info.knownIssues, (item) => cleanText(item.title).toLowerCase());
    const attachments = dedupeBy(resources.attachments, (item) =>
      `${cleanText(item.section).toLowerCase()}|${cleanText(item.fileName).toLowerCase()}`);
    const outOfScope = dedupeBy(scope.outOfScope, (item) =>
      `${cleanText(item.group).toLowerCase()}|${cleanText(item.asset).toLowerCase()}`);

    const policy = dedupeBy(info.policyParts.map(cleanText).filter(Boolean), (part) => part).join("\n\n");
    const outOfScopeDescription = dedupeBy(
      scope.outOfScopeParts.map(cleanText).filter(Boolean), (part) => part).join("\n\n");
    const feasibility = (() => {
      const parts = [];
      if (info.severitySections) parts.push(info.severitySections);
      if (info.pocSections) parts.push(info.pocSections);
      return parts.join("\n\n");
    })();

    const rewardNumbers = [];
    for (const row of info.rewardRows) {
      for (const value of Object.values(row.amounts || {})) {
        if (typeof value === "number" && Number.isFinite(value)) rewardNumbers.push(value);
      }
    }
    const rewardsDescription = cleanText(info.rewardProse || "");
    const currency = /\$[\d,]/.test(`${rewardsDescription}\n${policy}`) ? "USD" : "";

    let platformUpdatedAt = {};
    if (info.facts.lastUpdated) {
      const parsed = new Date(info.facts.lastUpdated);
      if (!Number.isNaN(parsed.getTime())) platformUpdatedAt = { program: parsed.toISOString() };
    }

    const complete = notes.length === 0;
    if (knownIssues.length > 0) {
      notes.push(`${knownIssues.length} known issue${knownIssues.length === 1 ? "" : "s"} already reported — check before submitting to avoid a duplicate.`);
    }

    return {
      platform: "immunefi",
      program: {
        name: cleanText(info.name) || slug,
        handle: slug,
        url: canonical,
        website: cleanText(info.website),
        about: cleanText(info.about),
      },
      capture: {
        source: {
          method: "first-party-api",
          description: "Immunefi program pages (information, scope, resources)",
          endpoint: canonical,
          ...(complete ? {} : { complete: false }),
        },
        platformUpdatedAt,
      },
      metadata: {
        slug,
        tags: info.facts.tags,
        maxBounty: cleanText(info.facts.maxBounty),
        maxBountyAmount: parseAmount(info.facts.maxBounty),
        liveSince: cleanText(info.facts.liveSince),
        lastUpdated: cleanText(info.facts.lastUpdated),
        vault: {
          fundsAvailable: cleanText(info.vault.fundsAvailable),
          average30d: cleanText(info.vault.average30d),
          assetsInVault: cleanText(info.vault.assetsInVault),
          address: cleanText(info.vault.address),
        },
        kycRequired: typeof info.facts.kycRequired === "boolean" ? info.facts.kycRequired : null,
        pocRequired: typeof info.facts.pocRequired === "boolean" ? info.facts.pocRequired : null,
        publicationCategory: cleanText(info.publicationCategory),
        audits: info.audits.map((audit) => ({
          auditor: cleanText(audit.auditor),
          completedAt: cleanText(audit.completedAt),
        })),
        totalAssets: inScope.length,
        totalImpacts: impacts.length,
      },
      guidelines: {
        policy,
        scopeDescription: cleanText(scope.impactsBody),
        outOfScopeDescription,
        faq: "",
        severityAssessment: feasibility,
        testingRequirements: {
          poc: typeof info.facts.pocRequired === "boolean" ? info.facts.pocRequired : null,
          kyc: typeof info.facts.kycRequired === "boolean" ? info.facts.kycRequired : null,
        },
        safeHarbor: { immunefi: null },
      },
      rewards: {
        currency,
        description: rewardsDescription,
        minimumReward: rewardNumbers.length > 0 ? Math.min(...rewardNumbers) : null,
        maximumReward: rewardNumbers.length > 0 ? Math.max(...rewardNumbers) : null,
        rows: info.rewardRows,
        tiers: [],
        poolTotal: null,
      },
      attachments,
      inScope,
      outOfScope,
      impacts,
      codeScope: null,
      knownIssues,
      knownIssuesAvailable: knownIssues.length > 0,
      notes,
    };
  };

  return main()
    .then((data) => ({ ok: true, data }))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Could not extract this Immunefi program's scope.",
    }));
}

function getImmunefiRoute(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "immunefi.com" && parsed.hostname !== "www.immunefi.com") return null;
    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    // /bug-bounty/ alone is the directory, not a program.
    if (segments.length < 2 || segments[0] !== "bug-bounty") return null;
    const slug = segments[1];
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) return null;
    let subpage = "information";
    if (segments.length >= 3) {
      const third = segments[2].toLowerCase();
      if (!["information", "scope", "resources"].includes(third)) return null;
      subpage = third;
    }
    if (segments.length > 3) return null;
    return { slug, subpage };
  } catch {
    return null;
  }
}

const immunefi = {
  id: "immunefi",
  label: "Immunefi",

  matches(url) {
    return Boolean(getImmunefiRoute(url));
  },

  async extract(context) {
    const route = getImmunefiRoute(context.url);
    if (!route) {
      throw new Error("Open an Immunefi bug bounty program page and try again.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      world: "MAIN",
      func: extractImmunefiPage,
      args: [route.slug, route.subpage],
    });
    const result = results?.[0]?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "Could not extract this Immunefi program's scope.");
    }
    return result.data;
  },
};

export default immunefi;
