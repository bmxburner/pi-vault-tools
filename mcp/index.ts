#!/usr/bin/env node

/**
 * Vault Tools MCP Server
 *
 * Exposes vault tools over the Model Context Protocol (MCP).
 * Fully self-contained — no pi extension dependency.
 *
 * Run: node mcp/index.js
 * Or:  bun run .agent/vault-tools/mcp/index.ts
 *
 * Environment:
 *   VAULT_ROOT — path to vault (default: auto-detect from cwd)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

// ══════════════════════════════════════════════════════════════
//  Vault root resolution
// ══════════════════════════════════════════════════════════════

/** Resolve vault root from env or cwd. */
function vaultRoot(): string {
  return process.env.VAULT_ROOT || process.env.WIKI_ROOT || process.cwd();
}

// ══════════════════════════════════════════════════════════════
//  Vault scanning utilities (inlined, no pi dependency)
// ══════════════════════════════════════════════════════════════

/** Find all vault notes (notes/** /*.md) — excludes _Trash, .obsidian, inbox, etc. */
function findVaultPages(
  notesDir: string,
): Array<{ path: string; relative: string; content: string }> {
  const results: Array<{ path: string; relative: string; content: string }> = [];
  const EXCLUDE_DIRS = new Set(["_Trash", ".obsidian", "_processed", "_failed", "raw", "node_modules", ".git"]);

  function walk(dir: string, rel: string) {
    if (!existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry) && !entry.startsWith(".")) {
          walk(full, rel ? `${rel}/${entry}` : entry);
        }
      } else if (entry.endsWith(".md")) {
        results.push({
          path: full,
          relative: rel ? `${rel}/${entry.slice(0, -3)}` : entry.slice(0, -3),
          content: readFileSync(full, "utf-8"),
        });
      }
    }
  }

  walk(notesDir, "");
  return results;
}

/** Parse vault-specific frontmatter fields (type, status, tags, project, date, description). */
function parseVaultFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  missingRequired: string[];
  present: string[];
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content, missingRequired: [], present: [] };

  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      frontmatter[key] = val;
    }
  }
  const body = match[2];
  const required = ["title", "type", "status", "date"];
  const missingRequired = required.filter((r) => !frontmatter[r]);
  return { frontmatter, body, missingRequired, present: Object.keys(frontmatter) };
}

/** Slugify a title. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

// ══════════════════════════════════════════════════════════════
//  Shared types
// ══════════════════════════════════════════════════════════════

type SearchResult = {
  id: string;
  title: string;
  type: string;
  preview: string;
};

// ══════════════════════════════════════════════════════════════
//  MCP Server
// ══════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "vault-tools",
  version: "1.0.0",
});

// ---- vault_recall ----

server.registerTool(
  "vault_recall",
  {
    description:
      "Search the notes vault for pages relevant to a query. Returns matching page IDs, titles, types, and content previews.",
    inputSchema: z.object({
      query: z.string().describe("Search query — use the user's full request or key terms"),
      max_results: z.number().optional().default(5).describe("Max results (default: 5, max: 10)"),
    }),
  },
  async ({ query, max_results }) => {
    const root = vaultRoot();
    const notesDir = join(root, "notes");
    if (!existsSync(notesDir)) {
      return {
        content: [{ type: "text" as const, text: "No notes/ directory found. Is VAULT_ROOT set correctly?" }],
        isError: true,
      };
    }

    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 10);
    if (terms.length === 0) {
      return { content: [{ type: "text" as const, text: "Query too short." }] };
    }

    const pages = findVaultPages(notesDir);
    const maxResults = Math.min(max_results ?? 5, 10);

    type Scored = { result: SearchResult; score: number };
    const scored: Scored[] = [];

    for (const page of pages) {
      const fm = parseVaultFrontmatter(page.content);
      const title = String(fm.frontmatter.title || page.relative.split("/").pop() || page.relative).toLowerCase();
      const body = fm.body.toLowerCase();
      const relative_ = page.relative;
      let score = 0;

      for (const term of terms) {
        if (relative_.toLowerCase().includes(term)) score += 3;
        if (title.includes(term)) score += 4;
        if (body.includes(term)) score += 1;
        const tags = String(fm.frontmatter.tags || "").toLowerCase();
        if (tags.includes(term)) score += 2;
        const noteType = String(fm.frontmatter.type || "").toLowerCase();
        if (noteType.includes(term)) score += 2;
        const project = String(fm.frontmatter.project || "").toLowerCase();
        if (project.includes(term)) score += 2;
      }

      if (score > 0) {
        const preview = fm.body.replace(/\n/g, " ").trim().slice(0, 200);
        scored.push({
          result: {
            id: relative_,
            title: String(fm.frontmatter.title || relative_.split("/").pop() || relative_),
            type: String(fm.frontmatter.type || "note"),
            preview,
          },
          score,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, maxResults).map((s) => s.result);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  },
);

// ---- vault_search ----

server.registerTool(
  "vault_search",
  {
    description: "Search the notes vault for pages matching a query.",
    inputSchema: z.object({
      query: z.string().describe("Search term"),
      type: z.string().optional().describe("Filter by note type (e.g. idea, decision, learning, insight)"),
    }),
  },
  async ({ query, type }) => {
    const root = vaultRoot();
    const notesDir = join(root, "notes");
    if (!existsSync(notesDir)) {
      return {
        content: [{ type: "text" as const, text: "No notes/ directory found. Is VAULT_ROOT set correctly?" }],
        isError: true,
      };
    }

    const pages = findVaultPages(notesDir);
    const q = query.toLowerCase();

    const matches = pages
      .filter((page) => {
        const fm = parseVaultFrontmatter(page.content);
        const title = String(fm.frontmatter.title || page.relative).toLowerCase();
        const pageType = String(fm.frontmatter.type || "").toLowerCase();
        const matchesQuery = page.relative.toLowerCase().includes(q) || title.includes(q);
        const matchesType = !type || pageType.includes(type.toLowerCase());
        return matchesQuery && matchesType;
      })
      .map((page) => {
        const fm = parseVaultFrontmatter(page.content);
        return {
          id: page.relative,
          title: String(fm.frontmatter.title || page.relative.split("/").pop() || page.relative),
          type: String(fm.frontmatter.type || "note"),
        };
      });

    return {
      content: [
        { type: "text" as const, text: matches.length > 0 ? JSON.stringify(matches, null, 2) : `No pages found for "${query}"` },
      ],
    };
  },
);

// ---- vault_status ----

server.registerTool(
  "vault_status",
  {
    description: "Show vault health and stats: total notes, frontmatter completeness, orphans.",
    inputSchema: z.object({}),
  },
  async () => {
    const root = vaultRoot();
    const notesDir = join(root, "notes");
    if (!existsSync(notesDir)) {
      return {
        content: [{ type: "text" as const, text: "No notes/ directory found. Is VAULT_ROOT set correctly?" }],
        isError: true,
      };
    }

    const pages = findVaultPages(notesDir);
    let withCompleteFrontmatter = 0;
    let orphans = 0;

    for (const page of pages) {
      const fm = parseVaultFrontmatter(page.content);
      if (fm.missingRequired.length === 0) withCompleteFrontmatter++;
      const wikilinks = page.content.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g);
      if (!wikilinks || wikilinks.length === 0) orphans++;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              totalNotes: pages.length,
              withCompleteFrontmatter,
              potentialOrphans: orphans,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---- vault_lint ----

server.registerTool(
  "vault_lint",
  {
    description:
      "Lint the notes vault for broken wikilinks, frontmatter issues, orphans, and staleness. Returns a structured JSON report.",
    inputSchema: z.object({
      mode: z.string().optional().default("all").describe("Lint mode: all | links | frontmatter | orphans | stale"),
      days: z.number().optional().default(120).describe("Staleness threshold in days"),
      fix: z.boolean().optional().default(false).describe("Auto-fix fixable frontmatter issues (safe defaults only)"),
      dry_run: z.boolean().optional().default(false).describe("Preview fixes without writing (requires fix: true)"),
    }),
  },
  async ({ mode, days, fix, dry_run }) => {
    const root = vaultRoot();
    const bunPath = process.env.BUN_PATH || "/Users/jimmy/.bun/bin/bun";
    const scriptPath = resolve(root, ".agent/vault-tools/scripts/vault-lint.ts");

    return new Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }>((resolvePromise) => {
      const proc = spawn(bunPath, [
        scriptPath,
        "--root", root,
        "--mode", mode || "all",
        "--days", String(days || 120),
        "--json",
        ...(fix ? ["--fix"] : []),
        ...(fix && dry_run ? ["--dry-run"] : []),
      ]);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code: number | null) => {
        if (code !== 0 && !stdout) {
          resolvePromise({
            content: [{ type: "text" as const, text: `vault-lint failed (exit ${code}): ${stderr || "Unknown error"}` }],
            isError: true,
          });
          return;
        }
        resolvePromise({ content: [{ type: "text" as const, text: stdout }] });
      });

      proc.on("error", (err: Error) => {
        resolvePromise({
          content: [{ type: "text" as const, text: `vault-lint error: ${err.message}` }],
          isError: true,
        });
      });
    });
  },
);

// ---- vault_retro ----

server.registerTool(
  "vault_retro",
  {
    description:
      "Save an atomic insight from a completed task into the vault. Creates a source packet and source page.",
    inputSchema: z.object({
      slug: z.string().describe("Unique kebab-case identifier (e.g. 'jwt-revocation-pattern')"),
      title: z.string().describe("Short descriptive title (60 chars max)"),
      body: z.string().describe("Markdown body explaining what was learned. Include [[wikilinks]] to related pages."),
      category: z.string().optional().describe("Category (e.g. frontend, architecture, devops, bugfix)"),
    }),
  },
  async ({ slug, title, body, category }) => {
    const root = vaultRoot();
    const notesDir = join(root, "notes");
    if (!existsSync(notesDir)) {
      return {
        content: [{ type: "text" as const, text: "No notes/ directory found. Is VAULT_ROOT set correctly?" }],
        isError: true,
      };
    }

    const date = new Date().toISOString().split("T")[0];
    const dir = join(root, "notes", "Home");
    mkdirSync(dir, { recursive: true });

    const categoryLine = category ? `\ncategory: ${category}` : "";
    const frontmatter = [
      "---",
      `title: ${title}`,
      `type: insight`,
      `status: active`,
      `date: ${date}`,
      `source_id: ${slug}${categoryLine}`,
      "---",
      "",
      body,
      "",
    ].join("\n");

    const fileSlug = slugify(title);
    const filePath = join(dir, `${fileSlug}.md`);
    writeFileSync(filePath, frontmatter, "utf-8");

    return {
      content: [{ type: "text" as const, text: `Insight saved: ${relative(root, filePath)}` }],
    };
  },
);

// ---- vault_capture_source ----

server.registerTool(
  "vault_capture_source",
  {
    description: "Capture a URL, local file, or pasted text into inbox/ for later processing.",
    inputSchema: z.object({
      text: z.string().optional().describe("Text content to capture"),
      url: z.string().optional().describe("URL to capture"),
      file_path: z.string().optional().describe("Local file path to capture"),
      title: z.string().optional().describe("Title for the captured source"),
    }),
  },
  async ({ text, url: urlParam, file_path, title }) => {
    const root = vaultRoot();
    const notesDir = join(root, "notes");
    if (!existsSync(notesDir)) {
      return {
        content: [{ type: "text" as const, text: "No notes/ directory found. Is VAULT_ROOT set correctly?" }],
        isError: true,
      };
    }

    const inboxDir = join(root, "inbox");
    mkdirSync(inboxDir, { recursive: true });

    const date = new Date().toISOString().split("T")[0];
    const displayTitle = title || (urlParam ? `Captured: ${urlParam}` : "Untitled capture");

    let body = "";
    if (urlParam) {
      body = `## Source\n\nURL: ${urlParam}\n\nCaptured: ${date}\n`;
    } else if (file_path) {
      body = `## Source\n\nFile: ${file_path}\n\nCaptured: ${date}\n`;
    } else if (text) {
      body = text;
    } else {
      return { content: [{ type: "text" as const, text: "Provide one of: text, url, or file_path" }], isError: true };
    }

    const frontmatter = [
      "---",
      `title: ${displayTitle}`,
      "type: capture",
      "status: inbox",
      `date: ${date}`,
      "---",
      "",
      body,
      "",
    ].join("\n");

    const slug = slugify(displayTitle);
    const timestamp = Date.now();
    const fileName = `${date}-${timestamp}-${slug || "untitled"}.md`;
    const filePath = join(inboxDir, fileName);
    writeFileSync(filePath, frontmatter, "utf-8");

    return { content: [{ type: "text" as const, text: `Source captured: ${fileName}` }] };
  },
);

// ---- vault_create_note ----

server.registerTool(
  "vault_create_note",
  {
    description:
      "Create a new markdown note in notes/ with populated frontmatter. Routes by area: Work or Home. Archived/journal/daily types go to Archive.",
    inputSchema: z.object({
      type: z.string().min(1).describe("Note type: idea | decision | learning | insight | blocker | opportunity | note"),
      title: z.string().min(1).describe("Note title"),
      body: z.string().describe("Markdown body content"),
      area: z.string().optional().describe("Area: Work | Home"),
      project: z.string().optional().describe("Project name (metadata only — folder routing is by area field)"),
      tags: z.array(z.string()).optional().describe("Tags for classification"),
      status: z.string().optional().describe("Status: active | archived | draft | inbox (default: active)"),
    }),
  },
  async ({ type, title, body, area, project, tags, status }) => {
    const root = vaultRoot();
    const date = new Date().toISOString().split("T")[0];

    let dir: string;
    if (area === "Work") {
      dir = join(root, "notes", "Work");
    } else if (type === "journal" || type === "daily" || status === "archived") {
      dir = join(root, "notes", "Archive");
    } else {
      dir = join(root, "notes", "Home");
    }
    mkdirSync(dir, { recursive: true });

    const tagLine = tags && tags.length > 0 ? `\ntags: [${tags.join(", ")}]` : "";
    const projectLine = project ? `\nproject: ${project}` : "";
    const frontmatter = [
      "---",
      `title: ${title}`,
      `type: ${type}`,
      `status: active`,
      `date: ${date}${projectLine}${tagLine}`,
      "---",
      "",
      body,
      "",
    ].join("\n");

    const slug = slugify(title);
    if (!slug) {
      return { content: [{ type: "text" as const, text: "Invalid title — could not generate slug. Aborting." }], isError: true };
    }
    const filePath = join(dir, `${slug}.md`);
    writeFileSync(filePath, frontmatter, "utf-8");

    return { content: [{ type: "text" as const, text: `Note created: ${relative(root, filePath)}` }] };
  },
);

// ---- vault_save_insight ----

server.registerTool(
  "vault_save_insight",
  {
    description:
      "Save an atomic insight as a note in notes/ with type: insight. Use for learnings, patterns, or discoveries.",
    inputSchema: z.object({
      title: z.string().min(1).describe("Short descriptive title (60 chars max)"),
      body: z.string().describe("Markdown body explaining what was learned. Include [[wikilinks]] to related notes."),
      project: z.string().optional().describe("Project name for routing"),
      category: z.string().optional().describe("Category label (e.g. architecture, devops, frontend)"),
    }),
  },
  async ({ title, body, project, category }) => {
    const root = vaultRoot();
    const date = new Date().toISOString().split("T")[0];

    const dir = join(root, "notes", "Home");
    mkdirSync(dir, { recursive: true });

    const categoryLine = category ? `\ncategory: ${category}` : "";
    const projectLine = project ? `\nproject: ${project}` : "";
    const frontmatter = [
      "---",
      `title: ${title}`,
      `type: insight`,
      `status: active`,
      `date: ${date}${projectLine}${categoryLine}`,
      "---",
      "",
      body,
      "",
    ].join("\n");

    const slug = slugify(title);
    if (!slug) {
      return { content: [{ type: "text" as const, text: "Invalid title — could not generate slug. Aborting." }], isError: true };
    }
    const filePath = join(dir, `${slug}.md`);
    writeFileSync(filePath, frontmatter, "utf-8");

    return { content: [{ type: "text" as const, text: `Insight saved: ${relative(root, filePath)}` }] };
  },
);

// ---- vault_capture_to_inbox ----

server.registerTool(
  "vault_capture_to_inbox",
  {
    description: "Capture text, URL, or file content into inbox/ with auto-populated frontmatter.",
    inputSchema: z.object({
      text: z.string().optional().describe("Text content to capture"),
      url: z.string().optional().describe("URL to capture"),
      file_path: z.string().optional().describe("Local file path to capture"),
      title: z.string().min(1).optional().describe("Title for the captured content"),
    }),
  },
  async ({ text, url: urlParam, file_path, title }) => {
    const root = vaultRoot();
    const inboxDir = join(root, "inbox");
    mkdirSync(inboxDir, { recursive: true });

    const date = new Date().toISOString().split("T")[0];
    const displayTitle = title || (urlParam ? `Captured: ${urlParam}` : "Untitled capture");

    let body = "";
    if (urlParam) {
      body = `## Source\n\nURL: ${urlParam}\n\nCaptured: ${date}\n`;
    } else if (file_path) {
      body = `## Source\n\nFile: ${file_path}\n\nCaptured: ${date}\n`;
    } else if (text) {
      body = text;
    } else {
      return { content: [{ type: "text" as const, text: "Provide one of: text, url, or file_path" }], isError: true };
    }

    const frontmatter = [
      "---",
      `title: ${displayTitle}`,
      "type: capture",
      "status: inbox",
      `date: ${date}`,
      "---",
      "",
      body,
      "",
    ].join("\n");

    const slug = slugify(displayTitle);
    const timestamp = Date.now();
    const fileName = `${date}-${timestamp}-${slug || "untitled"}.md`;
    const filePath = join(inboxDir, fileName);
    writeFileSync(filePath, frontmatter, "utf-8");

    return { content: [{ type: "text" as const, text: `Captured to inbox: ${fileName}` }] };
  },
);

// ─── Main ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🧠 Vault Tools MCP Server running on stdio");
}

main().catch((err) => {
  console.error("MCP Server error:", err);
  process.exit(1);
});
