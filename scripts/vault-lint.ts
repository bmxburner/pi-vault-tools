#!/usr/bin/env bun
/**
 * vault-lint.ts — Standalone vault-wide lint CLI
 *
 * Scans notes/ recursively for: broken wikilinks, frontmatter issues,
 * orphan detection, staleness. No pi dependency.
 *
 * Usage:
 *   bun scripts/vault-lint.ts --root /Volumes/Orico/Users/jimmy/Tars [--mode all|links|frontmatter|orphans|stale] [--json]
 *
 * Options:
 *   --root <path>       Vault root path (default: VAULT_PATH env or cwd)
 *   --mode <mode>       Lint mode: all, links, frontmatter, orphans, stale (default: all)
 *   --days <N>          Staleness threshold in days (default: 120)
 *   --json              Output as JSON
 *   --fix               Auto-fix fixable issues (frontmatter defaults)
 *
 * Exit codes:
 *   0 = no issues found
 *   1 = issues found
 *   2 = error
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

// Vault exclusions
const EXCLUDE_DIRS = new Set(["_Trash", ".obsidian", "_processed", "_failed", "raw", "node_modules", ".git", "Exports"]);

// ─── Config ─────────────────────────────────────────────

const args = process.argv.slice(2);
function getRootArg(): string {
  const idx = args.indexOf("--root");
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  const eq = args.find((a) => a.startsWith("--root="));
  if (eq) return eq.split("=")[1];
  return "";
}

const ROOT = resolve(
  getRootArg() ||
  process.env.VAULT_PATH ||
  process.cwd(),
);
function getArg(name, def) {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(name + "="));
  if (eq) return eq.split("=")[1];
  return def;
}
const MODE = getArg("--mode", "all");
const DAYS = parseInt(getArg("--days", "120"), 10);
const JSON_OUTPUT = args.includes("--json");
const AUTO_FIX = args.includes("--fix");
const DRY_RUN = args.includes("--dry-run");

// ─── Types ──────────────────────────────────────────────

interface LintResult {
  mode: string;
  scanned: number;
  links: { total: number; broken: number; report: BrokenLink[] };
  frontmatter: { checked: number; complete: number; incomplete: number; report: FrontmatterIssue[] };
  orphans: { total: number; report: string[] };
  staleness: { thresholdDays: number; stale: number; report: StaleNote[] };
  errors: string[];
}

interface BrokenLink {
  source: string;
  target: string;
  line: number;
}

interface FrontmatterIssue {
  path: string;
  missing: string[];
}

interface StaleNote {
  path: string;
  dateValue: string | null;
  mtime: string;
  daysSinceEdit: number;
  daysSinceDate: number | null;
}

// ─── Helpers (standalone, no pi dependency) ─────────────

function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = require("node:fs").readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          files.push(...collectMdFiles(full));
        }
      } else if (entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
  } catch {
    // skip
  }
  return files;
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { frontmatter, body: match[2] };
}

function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  // Strip fenced code blocks (``` ... ```) before extracting wikilinks
  const stripped = content.replace(/^```[\s\S]*?^```/gm, "");
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const target = m[1].trim();
    // Filter shell/bash false positives
    if (target.startsWith("$#") || target.startsWith(":") || /^:(space|punct|alpha|digit|alnum|lower|upper|print|graph|cntrl|blank|xdigit):$/.test(target)) continue;
    if (!target || target.startsWith("http")) continue;
    links.push(target);
  }
  return links;
}

function resolveWikilink(target: string, sourceDir: string, allFiles: Set<string>, nameIndex: Map<string, string[]>): string | null {
  const clean = target.split("#")[0].split("|")[0];
  if (!clean) return null;

  const targetWithExt = clean.endsWith(".md") ? clean : clean + ".md";

  // Path-based: resolve relative to source
  if (clean.includes("/") || clean.includes("\\")) {
    const fromSource = resolve(join(sourceDir, targetWithExt));
    if (existsSync(fromSource)) return fromSource;
    const fromRoot = resolve(join(ROOT, targetWithExt));
    if (existsSync(fromRoot)) return fromRoot;
    if (!clean.startsWith("..") && !clean.startsWith("notes/")) {
      const fromNotes = resolve(join(ROOT, "notes", targetWithExt));
      if (existsSync(fromNotes)) return fromNotes;
    }
  }

  // Filename-based: check against all file names
  const candidates = nameIndex.get(targetWithExt);
  if (candidates && candidates.length > 0) return candidates[0];

  // Try without extension
  const candidatesNoExt = nameIndex.get(clean);
  if (candidatesNoExt && candidatesNoExt.length > 0) return candidatesNoExt[0];

  return null;
}

// ─── Main ───────────────────────────────────────────────

async function main(): Promise<void> {
  const result: LintResult = {
    mode: MODE,
    scanned: 0,
    links: { total: 0, broken: 0, report: [] },
    frontmatter: { checked: 0, complete: 0, incomplete: 0, report: [] },
    orphans: { total: 0, report: [] },
    staleness: { thresholdDays: DAYS, stale: 0, report: [] },
    errors: [],
  };

  const notesDir = join(ROOT, "notes");
  if (!existsSync(notesDir)) {
    console.error(`[vault-lint] notes/ directory not found at ${notesDir}`);
    process.exit(2);
  }

  const start = Date.now();
  const allFiles = collectMdFiles(notesDir);

  // Build filename index for link resolution
  const nameIndex = new Map<string, string[]>();
  const fileSet = new Set<string>(allFiles);
  for (const f of allFiles) {
    const basename = f.split(sep).pop() || "";
    if (!nameIndex.has(basename)) nameIndex.set(basename, []);
    nameIndex.get(basename)!.push(f);
    // Also index without .md
    if (basename.endsWith(".md")) {
      const noExt = basename.slice(0, -3);
      if (!nameIndex.has(noExt)) nameIndex.set(noExt, []);
      nameIndex.get(noExt)!.push(f);
    }
    // Also index with full path
    const relPath = relative(ROOT, f);
    if (!nameIndex.has(relPath)) nameIndex.set(relPath, []);
    nameIndex.get(relPath)!.push(f);
  }

  const now = Date.now();
  const cutoffMs = now - DAYS * 24 * 60 * 60 * 1000;

  // Track incoming links for orphan detection
  const backlinks = new Map<string, number>();

  for (const filePath of allFiles) {
    result.scanned++;
    const relPath = relative(ROOT, filePath);
    const sourceDir = filePath.substring(0, filePath.lastIndexOf(sep));

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      result.errors.push(`Cannot read: ${relPath}`);
      continue;
    }

    const stats = statSync(filePath);
    const fm = parseFrontmatter(content);
    const links = MODE === "all" || MODE === "links" ? extractWikilinks(content) : [];

    // ── Broken links ──
    if (MODE === "all" || MODE === "links") {
      for (const link of links) {
        result.links.total++;
        backlinks.set(link, (backlinks.get(link) || 0) + 1);
        const resolved = resolveWikilink(link, sourceDir, fileSet, nameIndex);
        if (!resolved) {
          result.links.broken++;
          const lineNum = content.split("\n").findIndex((l: string) => l.includes(`[[${link}]]`)) + 1;
          result.links.report.push({ source: relPath, target: link, line: lineNum });
        }
      }
    }

    // ── Frontmatter ──
    const required = ["title", "type", "status", "date"];
    const missing = required.filter((r) => !fm.frontmatter[r]);
    if (MODE === "all" || MODE === "frontmatter") {
      result.frontmatter.checked++;
      if (missing.length > 0) {
        result.frontmatter.incomplete++;
        result.frontmatter.report.push({ path: relPath, missing });
      } else {
        result.frontmatter.complete++;
      }
    }

    // ── Auto-fix frontmatter (safe defaults only) ──
    if (AUTO_FIX && (MODE === "all" || MODE === "frontmatter") && missing.length > 0) {
      const updated: Record<string, string> = { ...fm.frontmatter };
      let fixed = false;

      if (!updated["title"]) {
        const headingMatch = content.match(/^#\s+(.+)$/m);
        if (headingMatch) {
          updated["title"] = headingMatch[1].trim();
          fixed = true;
        }
      }
      if (!updated["date"]) {
        updated["date"] = stats.mtime.toISOString().split("T")[0];
        fixed = true;
      }
      if (!updated["type"]) {
        updated["type"] = "note";
        fixed = true;
      }
      if (!updated["status"]) {
        updated["status"] = "active";
        fixed = true;
      }

      if (fixed) {
        const lines: string[] = ["---"];
        for (const [key, value] of Object.entries(updated)) {
          lines.push(`${key}: ${value}`);
        }
        lines.push("---", "", fm.body);

        if (!DRY_RUN) {
          try {
            writeFileSync(filePath, lines.join("\n"), "utf-8");
            result.frontmatter.incomplete--;
            result.frontmatter.complete++;
            result.frontmatter.report = result.frontmatter.report.filter((r: any) => r.path !== relPath);
          } catch (err) {
            result.errors.push(`Fix failed: ${relPath} \u2014 ${err}`);
          }
        }
      }
    }

    // ── Staleness ──
    if (MODE === "all" || MODE === "stale") {
      const dateVal = fm.frontmatter["date"] || null;
      const mtimeMs = stats.mtimeMs;
      const daysSinceEdit = Math.floor((now - mtimeMs) / (24 * 60 * 60 * 1000));
      const mtimeStr = stats.mtime.toISOString().split("T")[0];

      let daysSinceDate: number | null = null;
      if (dateVal) {
        const dm = dateVal.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (dm) {
          daysSinceDate = Math.floor((now - new Date(parseInt(dm[1]), parseInt(dm[2]) - 1, parseInt(dm[3])).getTime()) / (24 * 60 * 60 * 1000));
        }
      }

      const staleByMtime = mtimeMs < cutoffMs;
      const staleByDate = daysSinceDate !== null && daysSinceDate > DAYS;

      if (staleByMtime || staleByDate) {
        result.staleness.stale++;
        result.staleness.report.push({
          path: relPath,
          dateValue: dateVal,
          mtime: mtimeStr,
          daysSinceEdit,
          daysSinceDate,
        });
      }
    }
  }

  // ── Orphans (notes with no incoming links) ──
  if (MODE === "all" || MODE === "orphans") {
    for (const filePath of allFiles) {
      const relPath = relative(ROOT, filePath);
      const basename = filePath.split(sep).pop()?.replace(/\.md$/, "") || "";
      const incoming = backlinks.get(basename) || 0;

      // A note is an orphan if it has no incoming links and no outgoing links
      let outgoing = 0;
      try {
        const content = readFileSync(filePath, "utf-8");
        outgoing = extractWikilinks(content).length;
      } catch {}

      if (incoming === 0 && outgoing === 0) {
        result.orphans.total++;
        result.orphans.report.push(relPath);
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // ── Output ──
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ ...result, elapsed }, null, 2));
  } else {
    const hasIssues = result.links.broken > 0 || result.frontmatter.incomplete > 0 || result.orphans.total > 0 || result.staleness.stale > 0;
    console.log(`\n🔍 Vault Lint Report (${elapsed}s)`);
    console.log(`   Root: ${ROOT}`);
    console.log(`   Mode: ${MODE}`);
    console.log(`   Files scanned: ${result.scanned}`);
    console.log(`   `);
    console.log(`   🔗 Broken links: ${result.links.broken}/${result.links.total}`);
    if (result.links.broken > 0) {
      for (const b of result.links.report.slice(0, 10)) {
        console.log(`     • ${b.source}:${b.line} → [[${b.target}]]`);
      }
      if (result.links.report.length > 10) console.log(`     ... and ${result.links.report.length - 10} more`);
    }
    console.log(`   📋 Frontmatter incomplete: ${result.frontmatter.incomplete}/${result.frontmatter.checked}`);
    if (result.frontmatter.incomplete > 0) {
      for (const f of result.frontmatter.report.slice(0, 10)) {
        console.log(`     • ${f.path} — missing: ${f.missing.join(", ")}`);
      }
    }
    console.log(`   👤 Orphans: ${result.orphans.total}`);
    console.log(`   📅 Stale (>${DAYS}d): ${result.staleness.stale}`);
    if (result.errors.length > 0) {
      console.log(`\n   ⚠️ Errors: ${result.errors.length}`);
      for (const e of result.errors.slice(0, 5)) console.log(`     • ${e}`);
    }
    process.exit(hasIssues ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`[vault-lint] Fatal:`, err);
  process.exit(2);
});
