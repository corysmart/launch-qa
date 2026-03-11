const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

const GENERIC_CTA_LABELS = new Set([
  "click here",
  "learn more",
  "read more",
  "submit",
  "start",
  "more",
  "here"
]);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400;
  }
}

export class UpstreamFetchError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "UpstreamFetchError";
    this.statusCode = statusCode;
  }
}

export async function generateReviewReport(input, options = {}) {
  const normalizedInput = normalizeInput(input);
  const page = await resolvePage(normalizedInput, options.fetchImpl ?? fetch);
  const findings = dedupeFindings([
    ...runPageChecks(page),
    ...runScreenshotChecks(normalizedInput.screenshots)
  ]);
  const coverage = buildCoverage(normalizedInput, page);
  const summary = buildSummary(findings);

  return {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    input: {
      url: normalizedInput.url,
      screenshotCount: normalizedInput.screenshots.length,
      hasInlineHtml: Boolean(normalizedInput.html),
      context: normalizedInput.context
    },
    summary,
    findings,
    coverage,
    chatResponse: renderChatResponse(summary, findings, coverage)
  };
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const url = normalizeUrl(input.url);
  const html = typeof input.html === "string" && input.html.trim() ? input.html : null;
  const screenshots = normalizeScreenshots(input.screenshots);
  const context = normalizeContext(input.context);

  if (!url && !html && screenshots.length === 0) {
    throw new ValidationError("Provide at least one of: url, html, or screenshots.");
  }

  if (!url && html && screenshots.length === 0) {
    throw new ValidationError("Inline html must be paired with a source url or screenshots.");
  }

  return {
    url,
    html,
    screenshots,
    context
  };
}

function normalizeUrl(candidate) {
  if (candidate == null || candidate === "") {
    return null;
  }

  if (typeof candidate !== "string") {
    throw new ValidationError("url must be a string.");
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ValidationError("url must be a valid absolute http or https URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ValidationError("url must use http or https.");
  }

  return parsed.toString();
}

function normalizeScreenshots(value) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ValidationError("screenshots must be an array.");
  }

  if (value.length > 10) {
    throw new ValidationError("screenshots supports at most 10 items in v1.");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ValidationError(`screenshots[${index}] must be an object.`);
    }

    return {
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : `screenshot-${index + 1}`,
      mimeType: typeof entry.mimeType === "string" && entry.mimeType.trim() ? entry.mimeType.trim() : null,
      width: normalizeNonNegativeInteger(entry.width, `screenshots[${index}].width`),
      height: normalizeNonNegativeInteger(entry.height, `screenshots[${index}].height`),
      sizeBytes: normalizeNonNegativeInteger(entry.sizeBytes, `screenshots[${index}].sizeBytes`)
    };
  });
}

function normalizeNonNegativeInteger(value, label) {
  if (value == null || value === "") {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${label} must be a non-negative integer.`);
  }

  return value;
}

function normalizeContext(value) {
  if (value == null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("context must be an object when provided.");
  }

  return value;
}

async function resolvePage(input, fetchImpl) {
  if (!input.url && !input.html) {
    return null;
  }

  if (input.html) {
    return buildPageAnalysis({
      url: input.url,
      finalUrl: input.url,
      status: null,
      contentType: "text/html",
      html: input.html
    });
  }

  const response = await fetchImpl(input.url, {
    headers: {
      "user-agent": "Launch-QA/0.1.0"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new UpstreamFetchError(`Unable to fetch the page: ${response.status} ${response.statusText}`, 502);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new UpstreamFetchError("Fetched URL did not return an HTML document.", 422);
  }

  const html = await response.text();

  return buildPageAnalysis({
    url: input.url,
    finalUrl: response.url || input.url,
    status: response.status,
    contentType,
    html
  });
}

function buildPageAnalysis({ url, finalUrl, status, contentType, html }) {
  const title = extractFirstGroup(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = extractMetaContent(html, ["description"]);
  const canonical = extractLinkHref(html, ["canonical"]);
  const viewport = extractMetaContent(html, ["viewport"]);
  const robots = extractMetaContent(html, ["robots"]);
  const ogTitle = extractMetaContent(html, ["og:title"], "property");
  const ogDescription = extractMetaContent(html, ["og:description"], "property");
  const lang = extractFirstGroup(html, /<html[^>]*\blang\s*=\s*["']?([^"'\s>]+)/i);
  const h1Matches = html.match(/<h1\b[^>]*>/gi) ?? [];
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const missingAltCount = imgTags.filter((tag) => getAttribute(tag, "alt") == null).length;
  const actions = extractActions(html);

  return {
    url,
    finalUrl,
    status,
    contentType,
    title,
    description,
    canonical,
    viewport,
    robots,
    ogTitle,
    ogDescription,
    lang,
    h1Count: h1Matches.length,
    imageCount: imgTags.length,
    missingAltCount,
    actions,
    html
  };
}

function runPageChecks(page) {
  if (!page) {
    return [];
  }

  const findings = [];

  if (!page.title) {
    findings.push(
      createFinding({
        key: "seo-missing-title",
        category: "seo",
        severity: "high",
        title: "Missing page title",
        summary: "The document does not expose a title tag, which weakens search results and browser context.",
        recommendation: "Add a descriptive title tag for the page and keep it concise.",
        evidence: ["No <title> tag was detected."]
      })
    );
  } else {
    const titleLength = page.title.length;
    if (titleLength < 30 || titleLength > 65) {
      findings.push(
        createFinding({
          key: "seo-title-length",
          category: "seo",
          severity: "low",
          title: "Title length looks off",
          summary: "The title exists, but its length may limit scanability in search and browser tabs.",
          recommendation: "Aim for a title that is specific and roughly 30 to 65 characters long.",
          evidence: [`Current title length: ${titleLength} characters.`]
        })
      );
    }
  }

  if (!page.description) {
    findings.push(
      createFinding({
        key: "seo-missing-description",
        category: "seo",
        severity: "medium",
        title: "Missing meta description",
        summary: "The page does not provide a meta description for search or social previews.",
        recommendation: "Add a concise meta description that explains the page value and target action.",
        evidence: ["No meta description was detected."]
      })
    );
  }

  if (!page.canonical) {
    findings.push(
      createFinding({
        key: "seo-missing-canonical",
        category: "seo",
        severity: "low",
        title: "Missing canonical URL",
        summary: "Canonical metadata is absent, which can make indexing and duplicate URL handling less predictable.",
        recommendation: "Add a canonical link to the preferred URL for this page.",
        evidence: ["No canonical link tag was detected."]
      })
    );
  }

  if (!page.ogTitle || !page.ogDescription) {
    findings.push(
      createFinding({
        key: "seo-missing-og",
        category: "seo",
        severity: "low",
        title: "Social preview metadata is incomplete",
        summary: "Open Graph metadata is incomplete, so link previews may look weak when shared.",
        recommendation: "Provide both og:title and og:description for shareable pages.",
        evidence: [
          `og:title present: ${Boolean(page.ogTitle)}`,
          `og:description present: ${Boolean(page.ogDescription)}`
        ]
      })
    );
  }

  if (!page.viewport) {
    findings.push(
      createFinding({
        key: "responsive-missing-viewport",
        category: "responsiveness",
        severity: "high",
        title: "Missing mobile viewport meta tag",
        summary: "Without a viewport declaration, mobile browsers may render the page at an unusable scale.",
        recommendation: "Add a viewport meta tag such as width=device-width, initial-scale=1.",
        evidence: ["No viewport meta tag was detected."]
      })
    );
  }

  if (!page.lang) {
    findings.push(
      createFinding({
        key: "a11y-missing-lang",
        category: "accessibility",
        severity: "medium",
        title: "Missing document language",
        summary: "Assistive technologies depend on the html lang attribute to pronounce and interpret content correctly.",
        recommendation: "Set the html lang attribute to the primary language of the page.",
        evidence: ["No lang attribute was detected on the <html> element."]
      })
    );
  }

  if (page.imageCount > 0 && page.missingAltCount > 0) {
    findings.push(
      createFinding({
        key: "a11y-missing-alt",
        category: "accessibility",
        severity: "medium",
        title: "Images are missing alt attributes",
        summary: "Some images lack alt attributes, which leaves assistive technology users without equivalent context.",
        recommendation: "Add meaningful alt text for informative images and empty alt text for decorative ones.",
        evidence: [`${page.missingAltCount} of ${page.imageCount} image tags are missing alt attributes.`]
      })
    );
  }

  if (page.h1Count === 0) {
    findings.push(
      createFinding({
        key: "a11y-missing-h1",
        category: "accessibility",
        severity: "medium",
        title: "Missing primary heading",
        summary: "The page does not expose an h1, which weakens structure for scanning and assistive tools.",
        recommendation: "Add a single h1 that clearly states the page purpose.",
        evidence: ["No <h1> tag was detected."]
      })
    );
  } else if (page.h1Count > 1) {
    findings.push(
      createFinding({
        key: "a11y-multiple-h1",
        category: "accessibility",
        severity: "low",
        title: "Multiple primary headings detected",
        summary: "Multiple h1 tags can make page hierarchy less clear.",
        recommendation: "Reserve h1 for the main page heading and use lower heading levels for sections.",
        evidence: [`Detected ${page.h1Count} h1 tags.`]
      })
    );
  }

  const emptyActions = page.actions.filter((action) => !action.label && !action.ariaLabel && !action.title);
  if (emptyActions.length > 0) {
    findings.push(
      createFinding({
        key: "a11y-empty-actions",
        category: "accessibility",
        severity: "high",
        title: "Some interactive elements have no accessible label",
        summary: "Links or buttons without visible text or accessible labels are difficult or impossible to use with assistive technology.",
        recommendation: "Provide visible text or an explicit aria-label for every interactive control.",
        evidence: [`Detected ${emptyActions.length} interactive elements with no label.`]
      })
    );
  }

  const genericActions = page.actions.filter((action) => GENERIC_CTA_LABELS.has(action.label.toLowerCase()));
  if (genericActions.length >= 2) {
    findings.push(
      createFinding({
        key: "copy-generic-cta",
        category: "copy",
        severity: "medium",
        title: "Calls to action are too generic",
        summary: "Multiple links or buttons use vague labels, which can reduce clarity and conversion confidence.",
        recommendation: "Replace generic CTA copy with labels that state the outcome or next step.",
        evidence: [`Generic CTA labels detected: ${genericActions.slice(0, 4).map((action) => `"${action.label}"`).join(", ")}.`]
      })
    );
  }

  if (page.robots && /noindex/i.test(page.robots)) {
    findings.push(
      createFinding({
        key: "seo-noindex",
        category: "seo",
        severity: "high",
        title: "Page is marked noindex",
        summary: "The robots meta tag requests that search engines exclude this page from indexing.",
        recommendation: "Remove the noindex directive before launch if the page should appear in search.",
        evidence: [`robots meta content: ${page.robots}`]
      })
    );
  }

  return findings;
}

function runScreenshotChecks(screenshots) {
  if (screenshots.length === 0) {
    return [];
  }

  const findings = [];
  const missingDimensions = screenshots.filter((shot) => !shot.width || !shot.height);
  const mobileShots = screenshots.filter((shot) => isLikelyMobileScreenshot(shot));

  if (missingDimensions.length > 0) {
    findings.push(
      createFinding({
        key: "coverage-missing-screenshot-dimensions",
        category: "coverage",
        severity: "low",
        title: "Screenshot metadata is incomplete",
        summary: "Some screenshots are missing dimensions, which limits responsive analysis and evidence quality.",
        recommendation: "Include width and height metadata for each screenshot submission.",
        evidence: [`${missingDimensions.length} screenshot items are missing width or height.`]
      })
    );
  }

  if (screenshots.length === 1) {
    findings.push(
      createFinding({
        key: "coverage-single-screenshot",
        category: "coverage",
        severity: "low",
        title: "Only one screenshot was provided",
        summary: "A single screenshot gives limited coverage for layout, flows, and responsive review.",
        recommendation: "Include a mobile view and at least one additional key screen for stronger evidence.",
        evidence: [`Provided screenshot: ${screenshots[0].name}.`]
      })
    );
  }

  if (mobileShots.length === 0) {
    findings.push(
      createFinding({
        key: "coverage-missing-mobile-evidence",
        category: "coverage",
        severity: "medium",
        title: "No mobile-sized screenshot evidence",
        summary: "Responsive issues are harder to verify because the submission does not include a likely mobile view.",
        recommendation: "Add at least one portrait or narrow-width screenshot from a mobile-sized viewport.",
        evidence: [`Received ${screenshots.length} screenshots and none appear mobile-sized.`]
      })
    );
  }

  return findings;
}

function buildCoverage(input, page) {
  const limitations = [];

  if (!page) {
    limitations.push("No HTML document was available, so page-structure and metadata checks were skipped.");
  } else if (!input.html && input.url) {
    limitations.push("The review covered the fetched HTML response only and did not execute client-side browser automation.");
  }

  if (input.screenshots.length === 0) {
    limitations.push("No screenshots were supplied, so pixel-level visual review was not attempted.");
  }

  if (!input.url) {
    limitations.push("Without a live URL, broken links, redirects, and fetch-time metadata could not be verified.");
  }

  limitations.push("Authenticated staging areas, multi-step flows, and model-driven visual critique are out of scope in v1.");

  return {
    deterministicChecks: [
      "title and description metadata",
      "canonical and Open Graph tags",
      "viewport meta",
      "document language",
      "image alt coverage",
      "heading structure",
      "generic CTA detection",
      "screenshot evidence coverage"
    ],
    modelDrivenChecksPlanned: [
      "flow-level UX review",
      "visual hierarchy critique",
      "OCR and screenshot content understanding",
      "duplicate issue clustering"
    ],
    limitations
  };
}

function buildSummary(findings) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  let verdict = "close-to-ready";
  let headline = "No obvious launch blockers surfaced in the deterministic review.";

  if (counts.critical > 0 || counts.high > 0) {
    verdict = "blocked";
    headline = "Fix the high-severity launch risks before shipping.";
  } else if (counts.medium >= 2 || counts.low > 0) {
    verdict = "needs-work";
    headline = "The release looks close, but the review surfaced several quality gaps.";
  }

  return {
    verdict,
    headline,
    counts,
    topPriorities: findings.slice(0, 3).map((finding) => finding.title)
  };
}

function renderChatResponse(summary, findings, coverage) {
  const topFindings = findings.slice(0, 3);
  const topFindingLines = topFindings.length
    ? topFindings.map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.summary}`).join("\n")
    : "- No concrete issues were detected by the deterministic checks.";

  return [
    `Verdict: ${summary.verdict}`,
    summary.headline,
    "",
    "Top findings:",
    topFindingLines,
    "",
    "Coverage limits:",
    ...coverage.limitations.map((limitation) => `- ${limitation}`)
  ].join("\n");
}

function dedupeFindings(findings) {
  const byKey = new Map();

  for (const finding of findings) {
    const existing = byKey.get(finding.id);
    if (!existing) {
      byKey.set(finding.id, finding);
      continue;
    }

    const evidence = new Set([...existing.evidence, ...finding.evidence]);
    byKey.set(finding.id, {
      ...existing,
      evidence: [...evidence]
    });
  }

  return [...byKey.values()].sort(compareFindings);
}

function compareFindings(left, right) {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || left.title.localeCompare(right.title);
}

function createFinding({ key, category, severity, title, summary, recommendation, evidence }) {
  return {
    id: key,
    category,
    severity,
    title,
    summary,
    recommendation,
    evidence,
    source: "deterministic"
  };
}

function extractMetaContent(html, names, key = "name") {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta\\b[^>]*\\b${key}\\s*=\\s*["']${escapeRegExp(name)}["'][^>]*\\bcontent\\s*=\\s*(["'])([\\s\\S]*?)\\1[^>]*>`,
      "i"
    );
    const directMatch = html.match(pattern);
    if (directMatch) {
      return decodeEntities(directMatch[2].trim());
    }

    const reversePattern = new RegExp(
      `<meta\\b[^>]*\\bcontent\\s*=\\s*(["'])([\\s\\S]*?)\\1[^>]*\\b${key}\\s*=\\s*["']${escapeRegExp(name)}["'][^>]*>`,
      "i"
    );
    const reverseMatch = html.match(reversePattern);
    if (reverseMatch) {
      return decodeEntities(reverseMatch[2].trim());
    }
  }

  return null;
}

function extractLinkHref(html, relNames) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const rel = getAttribute(tag, "rel");
    if (!rel) {
      continue;
    }

    const relTokens = rel.toLowerCase().split(/\s+/);
    if (!relNames.some((name) => relTokens.includes(name))) {
      continue;
    }

    const href = getAttribute(tag, "href");
    if (href) {
      return decodeEntities(href);
    }
  }

  return null;
}

function extractActions(html) {
  const actions = [];

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    actions.push({
      kind: "link",
      label: normalizeText(stripTags(match[2])),
      ariaLabel: normalizeText(getAttribute(match[0], "aria-label")),
      title: normalizeText(getAttribute(match[0], "title"))
    });
  }

  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    actions.push({
      kind: "button",
      label: normalizeText(stripTags(match[2])),
      ariaLabel: normalizeText(getAttribute(match[0], "aria-label")),
      title: normalizeText(getAttribute(match[0], "title"))
    });
  }

  return actions;
}

function stripTags(value) {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalizeText(value) {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function getAttribute(tag, attributeName) {
  const pattern = new RegExp(
    `\\b${escapeRegExp(attributeName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = tag.match(pattern);

  if (!match) {
    return null;
  }

  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function extractFirstGroup(html, pattern) {
  const match = html.match(pattern);
  return match ? normalizeText(decodeEntities(match[1])) : null;
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelyMobileScreenshot(screenshot) {
  if (!screenshot.width || !screenshot.height) {
    return false;
  }

  return screenshot.width <= 600 || screenshot.height > screenshot.width;
}
