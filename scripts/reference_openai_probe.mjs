#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const ROOT_DIR = "/Users/sunmyeong/Documents/VibeDesignAgent";
const DEFAULT_SOURCES = [
  "awwwards.com",
  "behance.net",
  "pinterest.com",
  "pageflows.com",
  "mobbin.com",
  "refero.design",
];

const TAXONOMIES = [
  {
    id: "visual_style",
    label: "Visual Style",
    count: 1,
    sources: ["awwwards.com", "behance.net", "pinterest.com", "dribbble.com"],
    goal:
      "Find visual direction references for color usage, typography, scale, spacing, imagery, and brand tone. Prefer visually strong pages or projects.",
  },
  {
    id: "page_structure",
    label: "Page Structure",
    count: 1,
    sources: [
      "pageflows.com",
      "mobbin.com",
      "refero.design",
      "land-book.com",
      "lapa.ninja",
      "saaslandingpage.com",
    ],
    goal:
      "Find structure references for a single static page: section order, information hierarchy, layout, hero composition, and content blocks.",
  },
  {
    id: "content_components",
    label: "Content & Components",
    count: 1,
    sources: [
      "official websites",
      "app store pages",
      "google play pages",
      "product pages",
      "case studies",
    ],
    goal:
      "Find real product or service references for UX writing, CTA wording, domain conventions, trust signals, product cards, pricing, reviews, and static UI components.",
  },
];

function parseArgs(argv) {
  const args = {
    query: "wine subscription mobile app onboarding UI design",
    must: ["wine"],
    prefer: ["onboarding", "mobile", "subscription"],
    sources: DEFAULT_SOURCES,
    outDir: "exports/reference-probe",
    count: 12,
    model: "gpt-4o",
    balanced: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const next = argv[i + 1];
    if (item === "--query" && next) {
      args.query = next;
      i += 1;
    } else if (item === "--must" && next) {
      args.must = next.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      i += 1;
    } else if (item === "--prefer" && next) {
      args.prefer = next.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      i += 1;
    } else if (item === "--sources" && next) {
      args.sources = next.split(",").map((value) => value.trim()).filter(Boolean);
      i += 1;
    } else if (item === "--out" && next) {
      args.outDir = next;
      i += 1;
    } else if (item === "--count" && next) {
      args.count = Math.max(1, Number(next) || args.count);
      i += 1;
    } else if (item === "--model" && next) {
      args.model = next;
      i += 1;
    } else if (item === "--balanced") {
      args.balanced = true;
    }
  }
  return args;
}

async function loadEnv() {
  const text = await readFile(path.join(ROOT_DIR, ".env"), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`,
    "i",
  );
  return html.match(pattern)?.[1] ?? "";
}

function pageTitle(html) {
  return decodeHtml(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "",
  );
}

function domainFor(url, fallback = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return fallback.replace(/^www\./, "").toLowerCase();
  }
}

function canonicalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (/^(utm_|fbclid|gclid|igshid|mc_cid|mc_eid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    url.searchParams.sort();
    const pathname =
      url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathname}${url.search}`;
  } catch {
    return String(value).trim().replace(/\/+$/, "").toLowerCase();
  }
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\" && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function responseText(response) {
  let text = "";
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" || content.type === "text") {
        text += content.text ?? "";
      }
    }
  }
  return text;
}

function citationUrls(response) {
  const urls = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type !== "output_text" && content.type !== "text") continue;
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url) {
          urls.push(annotation.url);
        }
      }
    }
  }
  return Array.from(new Set(urls));
}

function citedUrlMatches(url, citedUrls) {
  const candidate = canonicalUrl(url);
  if (!candidate) return false;
  return citedUrls.some((cited) => {
    const canonical = canonicalUrl(cited);
    return (
      canonical === candidate ||
      canonical.startsWith(candidate) ||
      candidate.startsWith(canonical)
    );
  });
}

async function pickCandidates(openai, args, taxonomy = null) {
  const sources = taxonomy?.sources ?? args.sources;
  const count = taxonomy?.count ?? args.count;
  const taxonomyGoal = taxonomy
    ? `Taxonomy: ${taxonomy.label}. ${taxonomy.goal}`
    : "Taxonomy: unspecified. Balance visual, structure, and content usefulness.";
  const response = await openai.responses.create({
    model: args.model,
    tools: [{ type: "web_search_preview" }],
    input: [
      {
        role: "system",
        content: [
          "You are selecting real UI design reference URLs for a design tool experiment.",
          "Return a numbered list with citations. Every selected page must be cited using the web search citation mechanism.",
          "Do not invent URLs. Do not write raw URLs unless they are citations from web search.",
          "Each item should be one short sentence: title, source role, and why it is relevant.",
          "The cited page should be a concrete reference page, project page, screen page, case study, pin, portfolio project, or awarded site.",
          "Avoid search pages, tag pages, profile pages, generic category pages, and login-only pages.",
          "Prefer sources with inspectable screenshots or strong OG images.",
          "Use source roles:",
          "- awwwards.com for high-quality brand or visual web direction.",
          "- behance.net for project/case-study pages only.",
          "- pinterest.com for visual pins only.",
          "- pageflows.com for specific screen or flow pages.",
          "- mobbin.com only if you find a concrete app/screen page, not explore/list pages.",
          "- refero.design only if you find concrete app/screen/page URLs, not search/list pages.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Find ${count} real UI design reference page(s) for: ${args.query}.`,
          taxonomyGoal,
          `Must include concept(s): ${args.must.join(", ") || "none"}.`,
          `Prefer concept(s): ${args.prefer.join(", ") || "none"}.`,
          `Preferred sources: ${sources.join(", ")}.`,
          "The must concepts are more important than onboarding. If no source has both wine and onboarding, choose wine-specific design references first and say onboarding is missing.",
          "You may use high-quality portfolio/case-study sites outside the preferred sources when they are more relevant than the preferred sources.",
        ].join("\n"),
      },
    ],
  });
  const text = responseText(response);
  const citedUrls = citationUrls(response);
  return citedUrls.slice(0, count).map((url) => ({
    title: "",
    url,
    source: domainFor(url),
    taxonomy: taxonomy?.id ?? "general",
    taxonomyLabel: taxonomy?.label ?? "General",
    role: taxonomy?.label ?? "citation",
    reason:
      "Candidate URL came directly from OpenAI web_search citation annotations.",
    expectedDevice: "",
    expectedImageUrl: "",
    citationVerified: true,
  }));
}

async function hydrate(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 VibeDesignAgent openai reference probe",
      },
      signal: AbortSignal.timeout(9000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return {
        ok: response.ok,
        status: response.status,
        contentType,
        elapsedMs: Date.now() - startedAt,
        title: "",
        imageUrl: "",
        error: response.ok ? "non-html" : "http-error",
      };
    }
    const html = (await response.text()).slice(0, 300_000);
    const title =
      decodeHtml(metaContent(html, "og:title")) ||
      decodeHtml(metaContent(html, "twitter:title")) ||
      pageTitle(html);
    const image =
      decodeHtml(metaContent(html, "og:image")) ||
      decodeHtml(metaContent(html, "twitter:image")) ||
      decodeHtml(metaContent(html, "twitter:image:src"));
    return {
      ok: true,
      status: response.status,
      contentType,
      elapsedMs: Date.now() - startedAt,
      title,
      imageUrl: image ? new URL(image, url).toString() : "",
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      elapsedMs: Date.now() - startedAt,
      title: "",
      imageUrl: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function withConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const current = index;
      index += 1;
      results[current] = await tasks[current]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function pageKind(url) {
  const value = String(url ?? "").toLowerCase();
  if (/mobbin\.com\/explore\//.test(value)) return "listing";
  if (/refero\.design\/search/.test(value)) return "listing";
  if (/pageflows\.com\/(?:ios|android|web)\/flows\//.test(value)) return "listing";
  if (/pinterest\.[^/]+\/pin\//i.test(value)) return "pin";
  if (/behance\.net\/[^/]+\/?$/.test(value) || /behance\.net\/[^/]+\/appreciated/.test(value)) {
    return "profile";
  }
  if (/\/search\/?|\/tags?\//i.test(value)) return "listing";
  if (/\/collections?\//i.test(value) || /\/boards?\//i.test(value)) return "collection";
  if (/pinterest\.[^/]+\/[^/]+\/[^/]+\/?$/i.test(value)) return "collection";
  if (/behance\.net\/gallery\//i.test(value)) return "project";
  if (/pageflows\.com\/screens\//i.test(value)) return "screen";
  if (/refero\.design\/(?:screens|pages|apps)\//i.test(value)) return "screen";
  return "page";
}

function termHits(candidate, terms) {
  const text = [
    candidate.title,
    candidate.hydration?.title,
    candidate.url,
    candidate.reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.filter((term) => text.includes(term));
}

function scoreCandidate(candidate, args) {
  const kind = candidate.pageKind;
  const hasImage = candidate.finalImageUrl ? 2 : 0;
  const hydrated = candidate.hydration?.ok ? 1 : 0;
  const mustHits = candidate.mustHits.length * 3;
  const preferHits = candidate.preferHits.length;
  const badKindPenalty =
    kind === "listing" || kind === "profile" || kind === "collection" ? -4 : 0;
  const mustPenalty = args.must.length > 0 && candidate.mustHits.length === 0 ? -5 : 0;
  return hasImage + hydrated + mustHits + preferHits + badKindPenalty + mustPenalty;
}

function renderReport({ query, createdAt, candidates, must, prefer, balanced }) {
  const grouped = balanced
    ? TAXONOMIES.map((taxonomy) => [
        taxonomy.label,
        candidates.filter((candidate) => candidate.taxonomy === taxonomy.id),
      ])
    : [["Candidates", candidates]];
  const sections = grouped
    .map(([label, items]) => {
      const sectionCards = cardsFor(items);
      return `<section><h2>${escapeHtml(label)} <span>${items.length}</span></h2><div class="grid">${sectionCards || "<p>No candidates</p>"}</div></section>`;
    })
    .join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenAI Reference Probe</title>
  <style>
    body { margin: 0; background: #f7f7f4; color: #171717; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { position: sticky; top: 0; z-index: 1; background: rgba(247,247,244,.92); backdrop-filter: blur(12px); border-bottom: 1px solid #ddd; padding: 20px 28px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    header p { margin: 0; color: #666; font-size: 13px; }
    main { padding: 8px 28px 28px; }
    section { padding-top: 20px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    h2 span { color: #777; font-weight: 500; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }
    .card { overflow: hidden; border: 1px solid #ddd; background: white; border-radius: 8px; }
    .thumb { display: block; aspect-ratio: 16 / 10; background: #e7e5df; overflow: hidden; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .empty { height: 100%; display: grid; place-items: center; color: #888; font-size: 13px; }
    .meta { padding: 12px; }
    .badge { color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    h3 { margin: 6px 0; font-size: 14px; line-height: 1.35; }
    p { margin: 6px 0; color: #555; font-size: 12px; line-height: 1.45; }
    .url, .diag { overflow-wrap: anywhere; color: #777; }
  </style>
</head>
<body>
  <header>
    <h1>OpenAI Reference Probe</h1>
    <p>Query: ${escapeHtml(query)} · Must: ${escapeHtml(must.join(", ") || "none")} · Prefer: ${escapeHtml(prefer.join(", ") || "none")} · Created: ${escapeHtml(createdAt)}</p>
  </header>
  <main>${sections}</main>
</body>
</html>`;

  function cardsFor(items) {
    return items
      .map((candidate) => {
        const image = candidate.finalImageUrl
          ? `<img src="${escapeHtml(candidate.finalImageUrl)}" alt="">`
          : `<div class="empty">no image</div>`;
        return `<article class="card">
          <a class="thumb" href="${escapeHtml(candidate.url)}" target="_blank" rel="noreferrer">${image}</a>
          <div class="meta">
            <div class="badge">${escapeHtml(candidate.taxonomyLabel || "General")} · ${escapeHtml(candidate.source || domainFor(candidate.url))} · ${escapeHtml(candidate.pageKind)} · cited ${candidate.citationVerified ? "yes" : "no"} · score ${candidate.score}</div>
            <h3>${escapeHtml(candidate.hydration?.title || candidate.title || candidate.url)}</h3>
            <p>${escapeHtml(candidate.reason)}</p>
            <p class="url">${escapeHtml(candidate.url)}</p>
            <p class="diag">must ${escapeHtml(candidate.mustHits.join(", ") || "none")} · prefer ${escapeHtml(candidate.preferHits.join(", ") || "none")}</p>
            <p class="diag">hydrate ${candidate.hydration?.status ?? 0} · ${escapeHtml(candidate.hydration?.error || "ok")} · ${candidate.hydration?.elapsedMs ?? 0}ms</p>
          </div>
        </article>`;
      })
      .join("");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnv();
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY in .env");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const picked = args.balanced
    ? (
        await Promise.all(
          TAXONOMIES.map((taxonomy) => pickCandidates(openai, args, taxonomy)),
        )
      ).flat()
    : await pickCandidates(openai, args);
  const hydrated = await withConcurrency(
    picked.map((candidate) => async () => {
      const hydration = await hydrate(candidate.url);
      const finalImageUrl =
        candidate.expectedImageUrl || hydration.imageUrl || "";
      const enriched = {
        ...candidate,
        hydration,
        finalImageUrl,
        pageKind: pageKind(candidate.url),
      };
      return {
        ...enriched,
        mustHits: termHits(enriched, args.must),
        preferHits: termHits(enriched, args.prefer),
      };
    }),
    5,
  );
  const scored = hydrated
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, args),
    }))
    .sort((a, b) => b.score - a.score);
  const createdAt = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(ROOT_DIR, args.outDir);
  await mkdir(outDir, { recursive: true });
  const baseName = `reference-openai-probe-${createdAt}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const htmlPath = path.join(outDir, `${baseName}.html`);
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        query: args.query,
        must: args.must,
        prefer: args.prefer,
        sources: args.sources,
        balanced: args.balanced,
        taxonomies: args.balanced ? TAXONOMIES : [],
        candidates: scored,
      },
      null,
      2,
    ),
  );
  await writeFile(
    htmlPath,
    renderReport({
      query: args.query,
      createdAt,
      candidates: scored,
      must: args.must,
      prefer: args.prefer,
      balanced: args.balanced,
    }),
  );
  console.log(JSON.stringify({ total: scored.length, jsonPath, htmlPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
