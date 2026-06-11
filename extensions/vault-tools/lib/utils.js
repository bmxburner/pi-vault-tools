// utils.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function resolveVaultRoot(cwd) {
  if (existsSync(join(cwd, ".wiki", "config.json")))
    return cwd;
  let dir = cwd;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".wiki", "config.json")))
      return dir;
    dir = dirname(dir);
  }
  return cwd;
}
function getVaultPaths(root) {
  return {
    root,
    raw: join(root, "raw"),
    rawSources: join(root, "raw", "sources"),
    wiki: join(root, "wiki"),
    meta: join(root, "meta"),
    dotWiki: join(root, ".wiki"),
    outputs: join(root, "outputs"),
    discoveries: join(root, ".discoveries")
  };
}
function ensureVaultStructure(paths) {
  const dirs = [
    paths.rawSources,
    join(paths.raw, "assets"),
    join(paths.wiki, "sources"),
    join(paths.wiki, "entities"),
    join(paths.wiki, "concepts"),
    join(paths.wiki, "syntheses"),
    join(paths.wiki, "analyses"),
    paths.meta,
    paths.dotWiki,
    paths.outputs,
    paths.discoveries,
    join(paths.dotWiki, "templates"),
    join(paths.dotWiki, "templates", "pages")
  ];
  for (const d of dirs)
    mkdirSync(d, { recursive: true });
}
function readJson(path, defaultValue) {
  try {
    if (!existsSync(path))
      return defaultValue;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return defaultValue;
  }
}
function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}
`, "utf-8");
}
function readText(path) {
  try {
    if (!existsSync(path))
      return "";
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}
function nextSourceId(paths) {
  const today = new Date().toISOString().split("T")[0];
  const prefix = `SRC-${today}`;
  if (!existsSync(paths.rawSources))
    return `${prefix}-001`;
  const dirs = readdirSync(paths.rawSources).filter((d) => d.startsWith(prefix)).sort();
  if (dirs.length === 0)
    return `${prefix}-001`;
  const last = dirs[dirs.length - 1];
  const num = Number.parseInt(last.slice(-3), 10);
  return `${prefix}-${String(num + 1).padStart(3, "0")}`;
}
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match)
    return { frontmatter: {}, body: content };
  const frontmatter = {};
  const lines = match[1].split(`
`);
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body: match[2] };
}
function findWikiPages(wikiDir) {
  const results = [];
  function walk(dir, rel) {
    if (!existsSync(dir))
      return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel ? `${rel}/${entry}` : entry);
      } else if (entry.endsWith(".md")) {
        results.push({
          path: full,
          relative: rel ? `${rel}/${entry.slice(0, -3)}` : entry.slice(0, -3),
          content: readFileSync(full, "utf-8")
        });
      }
    }
  }
  walk(wikiDir, "");
  return results;
}
function findVaultPages(notesDir) {
  const results = [];
  const EXCLUDE_DIRS = new Set(["_Trash", ".obsidian", "_processed", "_failed", "raw", "node_modules", ".git"]);
  function walk(dir, rel) {
    if (!existsSync(dir))
      return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry) && !entry.startsWith(".")) {
          walk(full, rel ? `${rel}/${entry}` : entry);
        }
      } else if (entry.endsWith(".md")) {
        results.push({
          path: full,
          relative: rel ? `${rel}/${entry.slice(0, -3)}` : entry.slice(0, -3),
          content: readFileSync(full, "utf-8")
        });
      }
    }
  }
  walk(notesDir, "");
  return results;
}
function parseVaultFrontmatter(content) {
  const { frontmatter, body } = parseFrontmatter(content);
  const required = ["title", "type", "status", "date"];
  const optional = ["tags", "project", "description"];
  const fields = [...required, ...optional];
  const missingRequired = required.filter((r) => !frontmatter[r]);
  const present = fields.filter((f) => frontmatter[f]);
  return { frontmatter, body, missingRequired, present };
}
function extractWikilinks(content) {
  const links = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m = regex.exec(content);
  while (m !== null) {
    links.push(m[1]);
    m = regex.exec(content);
  }
  return links;
}
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
}
function fmtDate(d = new Date) {
  return d.toISOString().split("T")[0];
}
async function exec(pi, command, args, options) {
  const result = await pi.exec(command, args, options ?? {});
  return result;
}
function isProtectedPath(absPath, root) {
  const rawPath = resolve(root, "raw");
  const metaPath = resolve(root, "meta");
  const norm = resolve(absPath);
  if (norm.startsWith(`${rawPath}/`) || norm === rawPath) {
    return {
      protected: true,
      reason: "Raw sources are immutable. Use wiki_capture_source to add sources."
    };
  }
  if (norm.startsWith(`${metaPath}/`) || norm === metaPath) {
    return {
      protected: true,
      reason: "Metadata is auto-generated. Use wiki_rebuild_meta or wiki_log_event instead."
    };
  }
  return { protected: false };
}
export {
  writeJson,
  slugify,
  resolveVaultRoot,
  readText,
  readJson,
  parseVaultFrontmatter,
  parseFrontmatter,
  nextSourceId,
  isProtectedPath,
  getVaultPaths,
  fmtDate,
  findWikiPages,
  findVaultPages,
  extractWikilinks,
  exec,
  ensureVaultStructure
};
