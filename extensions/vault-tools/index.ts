import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { installGuardrails } from "./lib/guardrails.js";
import { formatRecallContext, registerWikiRecall, searchWiki } from "./lib/recall.js";
import { registerWikiRetro } from "./lib/retro.js";
import {
  registerWikiLogEvent,
  registerWikiSearch,
  registerWikiStatus,
  registerWikiWatch,
} from "./lib/tools.js";
import { getVaultPaths, resolveVaultRoot } from "./lib/utils.js";

/**
 * @zosmaai/pi-llm-wiki — LLM Wiki extension for Pi
 *
 * Registers 11 custom tools and installs guardrails:
 * All 10 original tools + wiki_recall (auto-recall at session start)
 *
 * Guardrails:
 * - Blocks direct edits to raw/** and meta/**
 * - Auto-rebuilds metadata after wiki/** edits
 *
 * Auto-recall:
 * - before_agent_start hook searches wiki for pages relevant to user prompt
 * - Injects matching knowledge as system context
 * - wiki_recall tool available for explicit deep searches
 */

export default function (pi: ExtensionAPI) {
  registerWikiSearch(pi);
  registerWikiStatus(pi);
  registerWikiLogEvent(pi);
  registerWikiWatch(pi);
  registerWikiRecall(pi);
  registerWikiRetro(pi);

  installGuardrails(pi);

  pi.on("session_start", async (_event, ctx) => {
    // Vault-tools status disabled — footer extension handles display
  });

  // ─── Auto-recall hook ──────────────────────────────
  // Before each agent turn, search vault notes for pages relevant
  // to the user's prompt and inject them as system context.
  pi.on("before_agent_start", async (event, _ctx) => {
    const root = resolveVaultRoot(process.cwd());
    const paths = getVaultPaths(root);

    const prompt = event.prompt || "";
    if (!prompt.trim()) return;

    const notesDir = join(root, "notes");
    if (!existsSync(notesDir)) return;

    const { findVaultPages, parseVaultFrontmatter } = await import("./lib/utils.js");
    const pages = findVaultPages(notesDir);
    const terms = prompt.toLowerCase().split(/\s+/).filter((t: string) => t.length > 3);

    const scored = pages
      .map((page: any) => {
        const fm = parseVaultFrontmatter(page.content);
        const title = String(fm.frontmatter.title || page.relative).toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (title.includes(term)) score += 4;
          if (page.relative.toLowerCase().includes(term)) score += 3;
        }
        return { page, score, fm };
      })
      .filter((s: any) => s.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 5);

    if (scored.length === 0) return;

    const context = scored
      .map((s: any) =>
        `- [[${s.page.relative}]] \u2014 ${s.fm.frontmatter.type || "note"} \u2014 ${s.fm.frontmatter.title || s.page.relative.split("/").pop()}`
      )
      .join("\n");

    return {
      systemPrompt: `${event.systemPrompt}\n\n## Relevant Vault Knowledge\n\n${context}\n\nUse \`read\` to view full pages.\n`,
    };
  });
}
