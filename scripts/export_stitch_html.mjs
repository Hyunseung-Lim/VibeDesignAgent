#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { Stitch, StitchToolClient } from "@google/stitch-sdk";

const ROOT_DIR = process.cwd();
// Paths are overridable via env so a scoped backup can point at its own
// sessions.json / output dir without clobbering the global export files.
const SESSIONS_PATH =
  process.env.STITCH_SESSIONS_PATH || path.join(ROOT_DIR, "exports", "sessions.json");
const OUTPUT_DIR =
  process.env.STITCH_HTML_OUT || path.join(ROOT_DIR, "exports", "stitch-html");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");

function safeName(value, fallback) {
  const raw = String(value || "").trim();
  const name = raw || fallback;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80);
}

async function loadDotenv() {
  const candidates = [".env.local", ".env"];
  for (const filename of candidates) {
    try {
      const body = await fs.readFile(path.join(ROOT_DIR, filename), "utf8");
      for (const line of body.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Optional local env files are allowed to be absent.
    }
  }
}

async function readJson(filePath) {
  const body = await fs.readFile(filePath, "utf8");
  return JSON.parse(body);
}

async function fetchStitchHtml(project, screenId) {
  const screen = await project.getScreen(screenId);
  const htmlUrlOrContent = await screen.getHtml();
  if (!htmlUrlOrContent) return "";
  if (!htmlUrlOrContent.startsWith("http")) return htmlUrlOrContent;

  const response = await fetch(htmlUrlOrContent);
  if (!response.ok) {
    throw new Error(`Failed to download Stitch HTML: ${response.status}`);
  }
  return response.text();
}

function collectScreens(sessions) {
  const screens = [];

  for (const [email, missions] of Object.entries(sessions)) {
    for (const [missionTitle, session] of Object.entries(missions || {})) {
      const projectId = session?.stitchProjectId;
      if (!projectId) continue;

      for (const artboard of session?.artboards || []) {
        if (!artboard?.stitchScreenId) continue;
        screens.push({
          email,
          missionTitle,
          missionId: session.missionId || "",
          projectId: String(projectId),
          artboardId: String(artboard.id || artboard.stitchScreenId),
          artboardLabel: String(artboard.label || ""),
          screenId: String(artboard.stitchScreenId),
        });
      }
    }
  }

  return screens;
}

await loadDotenv();

function envValue(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function stitchConfig() {
  const accessToken = envValue("STITCH_ACCESS_TOKEN");
  const projectId = envValue("STITCH_GOOGLE_CLOUD_PROJECT") || envValue("GOOGLE_CLOUD_PROJECT");
  if (accessToken && projectId) return { accessToken, projectId };

  const apiKey = envValue("STITCH_API_KEY");
  if (apiKey) return { apiKey };

  return null;
}

const authConfig = stitchConfig();
if (!authConfig) {
  console.log(
    "Stitch HTML export skipped: set STITCH_API_KEY or STITCH_ACCESS_TOKEN with GOOGLE_CLOUD_PROJECT.",
  );
  process.exit(0);
}

let sessions;
try {
  sessions = await readJson(SESSIONS_PATH);
} catch {
  console.log(`Stitch HTML export skipped: cannot read ${SESSIONS_PATH}.`);
  process.exit(0);
}

const screens = collectScreens(sessions);
if (screens.length === 0) {
  console.log("Stitch HTML export skipped: no stitch-backed artboards found.");
  process.exit(0);
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const client = new StitchToolClient(authConfig);
const stitchSdk = new Stitch(client);
const manifest = [];

for (const item of screens) {
  const project = stitchSdk.project(item.projectId);
  const destDir = path.join(
    OUTPUT_DIR,
    safeName(item.email, "unknown-user"),
    safeName(item.missionTitle, item.missionId || "unknown-mission"),
  );
  const filename = `${safeName(item.artboardId, item.screenId)}.html`;
  const destPath = path.join(destDir, filename);

  try {
    const html = await fetchStitchHtml(project, item.screenId);
    if (!html) throw new Error("Empty HTML from Stitch");

    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(destPath, html, "utf8");
    manifest.push({
      ...item,
      status: "exported",
      path: path.relative(ROOT_DIR, destPath),
      exportedAt: new Date().toISOString(),
    });
    console.log(`  ✓ ${path.relative(ROOT_DIR, destPath)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    manifest.push({
      ...item,
      status: "error",
      error: message,
      exportedAt: new Date().toISOString(),
    });
    console.warn(`  ! ${item.screenId}: ${message}`);
  }
}

await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
console.log(`Saved: ${path.relative(ROOT_DIR, MANIFEST_PATH)} (${manifest.length} screens)`);
