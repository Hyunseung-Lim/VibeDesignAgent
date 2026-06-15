#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = "/Users/sunmyeong/Documents/VibeDesignAgent";
const DEFAULT_DOMAINS = [
  "mobbin.com",
  "refero.design",
  "pageflows.com",
  "behance.net",
  "pinterest.com",
  "awwwards.com",
];

function parseArgs(argv) {
  const args = {
    query: "mobile banking onboarding app UI design",
    domains: DEFAULT_DOMAINS,
    outDir: "exports/reference-probe",
    perDomain: 6,
    must: [],
    prefer: [],
    strictDomains: true,
    requireMust: false,
    excludeKinds: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const next = argv[i + 1];
    if (item === "--query" && next) {
      args.query = next;
      i += 1;
    } else if (item === "--domains" && next) {
      args.domains = next.split(",").map((value) => value.trim()).filter(Boolean);
      i += 1;
    } else if (item === "--out" && next) {
      args.outDir = next;
      i += 1;
    } else if (item === "--per-domain" && next) {
      args.perDomain = Math.max(1, Number(next) || args.perDomain);
      i += 1;
    } else if (item === "--must" && next) {
      args.must = next.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      i += 1;
    } else if (item === "--prefer" && next) {
      args.prefer = next.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      i += 1;
    } else if (item === "--loose-domains") {
      args.strictDomains = false;
    } else if (item === "--require-must") {
      args.requireMust = true;
    } else if (item === "--exclude-kinds" && next) {
      args.excludeKinds = next.split(",").map((value) => value.trim()).filter(Boolean);
      i += 1;
    }
  }
  return args;
}

async function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  const text = await readFile(envPath, "utf8").catch(() => "");
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

async function serper(endpoint, q, num) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("Missing SERPER_API_KEY in .env");
  const response = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, num }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Serper ${endpoint} failed ${response.status}: ${text}`);
  }
  return response.json();
}

async function hydrate(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 VibeDesignAgent reference probe",
      },
      signal: AbortSignal.timeout(8000),
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

function toWebCandidate(item, query, sourceDomain) {
  return {
    provider: "serper-web",
    query,
    sourceDomain,
    title: item.title ?? "",
    snippet: item.snippet ?? "",
    url: item.link ?? "",
    displayLink: item.displayLink ?? "",
    imageUrl: "",
  };
}

function toImageCandidate(item, query, sourceDomain) {
  return {
    provider: "serper-image",
    query,
    sourceDomain,
    title: item.title ?? "",
    snippet: "",
    url: item.link ?? "",
    displayLink: item.source ?? "",
    imageUrl: item.imageUrl || "",
    thumbnailUrl: item.thumbnailUrl || "",
  };
}

function domainQueries(domain, query, must, prefer) {
  const mustText = must.join(" ");
  const preferText = prefer.join(" ");
  const compact = [mustText, preferText].filter(Boolean).join(" ");
  return Array.from(
    new Set([
      `site:${domain} ${query}`,
      compact ? `site:${domain} ${compact} UI design` : "",
      mustText ? `site:${domain} ${mustText} mobile UI screenshot` : "",
    ].filter(Boolean)),
  );
}

function actualDomainMatches(candidate) {
  if (candidate.sourceDomain === "broad") return true;
  return domainFor(candidate.url, candidate.displayLink).endsWith(candidate.sourceDomain);
}

async function collectCandidates({ query, domains, perDomain, must, prefer, strictDomains }) {
  const batches = [];
  for (const domain of domains) {
    for (const domainQuery of domainQueries(domain, query, must, prefer)) {
      batches.push(
        serper("search", domainQuery, perDomain).then((data) =>
          (data.organic ?? []).map((item) =>
            toWebCandidate(item, domainQuery, domain),
          ),
        ),
      );
      batches.push(
        serper("images", `${domainQuery} UI screenshot`, perDomain).then(
          (data) =>
            (data.images ?? []).map((item) =>
              toImageCandidate(item, `${domainQuery} UI screenshot`, domain),
            ),
        ),
      );
    }
  }
  batches.push(
    serper(
      "images",
      `${query} ${must.join(" ")} UI design reference screenshot mobbin refero pageflows behance pinterest`,
      Math.max(10, perDomain * 2),
    ).then((data) =>
      (data.images ?? []).map((item) =>
        toImageCandidate(item, `${query} broad image`, "broad"),
      ),
    ),
  );

  const raw = (await Promise.allSettled(batches)).flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const seen = new Set();
  return raw.filter((candidate) => {
    if (!candidate.url) return false;
    if (strictDomains && !actualDomainMatches(candidate)) return false;
    const key = canonicalUrl(candidate.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pageKind(candidate) {
  const url = candidate.url.toLowerCase();
  if (/mobbin\.com\/explore\//.test(url)) return "listing";
  if (/refero\.design\/search/.test(url)) return "listing";
  if (/pageflows\.com\/(?:ios|android|web)\/flows\//.test(url)) return "listing";
  if (/pinterest\.[^/]+\/pin\//i.test(url)) return "pin";
  if (/behance\.net\/[^/]+\/?$/.test(url) || /behance\.net\/[^/]+\/appreciated/.test(url)) {
    return "profile";
  }
  if (/\/search\/?|\/tags?\//i.test(url)) return "listing";
  if (/\/collections?\//i.test(url) || /\/boards?\//i.test(url)) return "collection";
  if (/pinterest\.[^/]+\/[^/]+\/[^/]+\/?$/i.test(url)) return "collection";
  if (/behance\.net\/gallery\//i.test(url)) return "project";
  if (/pageflows\.com\/screens\//i.test(url)) return "screen";
  if (/refero\.design\/(?:screens|pages|apps)\//i.test(url)) return "screen";
  return "page";
}

function termHits(candidate, terms) {
  const text = [
    candidate.title,
    candidate.finalTitle,
    candidate.snippet,
    candidate.url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.filter((term) => text.includes(term));
}

function scoreCandidate(candidate, { must, prefer }) {
  const urlDomain = domainFor(candidate.url, candidate.displayLink);
  const sourceMatch =
    candidate.sourceDomain !== "broad" && urlDomain.endsWith(candidate.sourceDomain)
      ? 2
      : 0;
  const hasImage = candidate.finalImageUrl ? 2 : 0;
  const hydrated = candidate.hydration?.ok ? 1 : 0;
  const kind = pageKind(candidate);
  const mustHits = termHits(candidate, must);
  const preferHits = termHits(candidate, prefer);
  const mustPenalty = must.length > 0 && mustHits.length === 0 ? -4 : 0;
  const listingPenalty =
    kind === "listing" || kind === "profile" || kind === "collection" ? -3 : 0;
  const mobileBonus = /mobile|iphone|ios|android|app/i.test(
    `${candidate.title} ${candidate.finalTitle} ${candidate.snippet} ${candidate.url}`,
  )
    ? 1
    : 0;
  return (
    sourceMatch +
    hasImage +
    hydrated +
    mustHits.length * 3 +
    preferHits.length +
    mobileBonus +
    mustPenalty +
    listingPenalty
  );
}

function renderReport({ query, domains, createdAt, candidates, must, prefer }) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = candidate.sourceDomain;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }
  const groups = domains.concat("broad").map((domain) => [
    domain,
    grouped.get(domain) ?? [],
  ]);
  const cards = groups
    .map(([domain, items]) => {
      const body = items
        .sort((a, b) => b.score - a.score)
        .map((candidate) => {
          const imageUrl = candidate.displayImageUrl || candidate.finalImageUrl;
          const image = candidate.finalImageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="">`
            : `<div class="empty">no image</div>`;
          return `<article class="card">
            <a class="thumb" href="${escapeHtml(candidate.url)}" target="_blank" rel="noreferrer">${image}</a>
            <div class="meta">
              <div class="badge">${escapeHtml(candidate.provider)} · ${escapeHtml(candidate.pageKind)} · score ${candidate.score}</div>
              <h3>${escapeHtml(candidate.finalTitle || candidate.title || candidate.url)}</h3>
              <p>${escapeHtml(candidate.snippet)}</p>
              <p class="url">${escapeHtml(candidate.url)}</p>
              <p class="diag">must ${escapeHtml(candidate.mustHits.join(", ") || "none")} · prefer ${escapeHtml(candidate.preferHits.join(", ") || "none")}</p>
              <p class="diag">hydrate ${candidate.hydration?.status ?? 0} · ${escapeHtml(candidate.hydration?.error || "ok")} · ${candidate.hydration?.elapsedMs ?? 0}ms</p>
            </div>
          </article>`;
        })
        .join("");
      return `<section><h2>${escapeHtml(domain)} <span>${items.length}</span></h2><div class="grid">${body || "<p>No candidates</p>"}</div></section>`;
    })
    .join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reference Source Probe</title>
  <style>
    body { margin: 0; background: #f7f7f4; color: #171717; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { position: sticky; top: 0; z-index: 1; background: rgba(247,247,244,.92); backdrop-filter: blur(12px); border-bottom: 1px solid #ddd; padding: 20px 28px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    header p { margin: 0; color: #666; font-size: 13px; }
    section { padding: 24px 28px; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    h2 span { color: #777; font-weight: 500; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 14px; }
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
    <h1>Reference Source Probe</h1>
    <p>Query: ${escapeHtml(query)} · Must: ${escapeHtml(must.join(", ") || "none")} · Prefer: ${escapeHtml(prefer.join(", ") || "none")} · Created: ${escapeHtml(createdAt)}</p>
  </header>
  ${cards}
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnv();
  const candidates = await collectCandidates(args);
  const hydrated = await withConcurrency(
    candidates.map((candidate) => async () => {
      const hydration = await hydrate(candidate.url);
      const finalImageUrl = candidate.imageUrl || hydration.imageUrl || candidate.thumbnailUrl || "";
      const displayImageUrl = candidate.thumbnailUrl || candidate.imageUrl || hydration.imageUrl || "";
      const finalTitle = hydration.title || candidate.title || "";
      return {
        ...candidate,
        hydration,
        finalImageUrl,
        displayImageUrl,
        finalTitle,
      };
    }),
    5,
  );
  const scored = hydrated
    .map((candidate) => ({
      ...candidate,
      pageKind: pageKind(candidate),
      mustHits: termHits(candidate, args.must),
      preferHits: termHits(candidate, args.prefer),
      score: scoreCandidate(candidate, args),
    }))
    .filter((candidate) => !args.requireMust || candidate.mustHits.length > 0)
    .filter((candidate) => !args.excludeKinds.includes(candidate.pageKind))
    .sort((a, b) => b.score - a.score);
  const createdAt = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(ROOT_DIR, args.outDir);
  await mkdir(outDir, { recursive: true });
  const baseName = `reference-probe-${createdAt}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const htmlPath = path.join(outDir, `${baseName}.html`);
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        query: args.query,
        domains: args.domains,
        must: args.must,
        prefer: args.prefer,
        strictDomains: args.strictDomains,
        requireMust: args.requireMust,
        excludeKinds: args.excludeKinds,
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
      domains: args.domains,
      createdAt,
      candidates: scored,
      must: args.must,
      prefer: args.prefer,
    }),
  );
  console.log(JSON.stringify({ total: scored.length, jsonPath, htmlPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
