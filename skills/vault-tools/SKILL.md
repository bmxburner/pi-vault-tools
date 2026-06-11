---
name: vault-tools
description: LLM-native vault maintenance for TARS. Single-store notes/ with frontmatter-driven organization, automated linting, and scheduled inbox processing.
---

# Vault Tools (v3 — LLM-Native)

Single-store vault living in `notes/`. Organization by frontmatter fields (`project:`, `type:`, `status:`, `tags:`, `date:`), not folder paths. LLM is the primary interface. No Obsidian dependency.

## Architecture

```
WIKI_ROOT/
├── notes/                     # Single vault store (you own this)
│   ├── Work/                  # Career, work projects, work communications
│   ├── Home/                  # Everything personal (health, finance, family, projects, goals)
│   └── Archive/               # Completed, stale, or era-artifacts
├── inbox/                     # Unprocessed captures
│   ├── _processed/            # Successfully processed inbox items
│   └── _failed/               # Failed processing (with error logs)
├── .agent/archives/           # Historical artifacts
│   └── wiki-overlay/          # Archived wiki overlay (read-only)
│       ├── wiki/
│       ├── .wiki/
│       └── meta/
└── raw/                       # Daemon workspace — file conversion → inbox/
```

## Golden Rules

1. **FRONTMATTER IS THE ORGANIZATION AXIS.** Not folder paths. Every note needs `type:`, `status:`, `date:`, and optionally `project:`, `tags:`.
2. **ALWAYS LINK NOTES.** Every note should have `## Connections` with at least one `[[wikilink]]` to related content.
3. **INBOX IS TEMPORARY.** Process inbox items promptly — classify, populate frontmatter, move to appropriate notes/ location.
4. **ONLY ARCHIVE, NO DELETES.** Preserve artifacts — archive stale notes rather than deleting.

## Available Tools

### MCP Tools (9)

| Tool | Purpose |
|---|---|
| `vault_recall` | Search notes/ for task-relevant pages (auto-called at turn start) |
| `vault_search` | Search notes/ frontmatter + full-text for pages |
| `vault_status` | Instant vault stats (note count, frontmatter health, orphans) |
| `vault_lint` | Health check with 4 modes (links, frontmatter, orphans, stale). Supports `--fix` for auto-repair. |
| `vault_retro` | Save an atomic insight into notes/Home/ as `type: insight` |
| `vault_capture_source` | Capture URL/file/text into inbox/ for later processing |
| `vault_create_note` | Create a new note with full frontmatter in the correct notes/ location |
| `vault_save_insight` | Save a quick insight to notes/Home/ |
| `vault_capture_to_inbox` | Append raw text to a new inbox file |

### Extension Tools (6)

| Tool | Purpose |
|---|---|
| `vault_recall` | Auto-search notes/ before every user turn |
| `vault_search` | Search notes/ from extension |
| `vault_status` | Vault health from extension |
| `vault_retro` | Save insight from extension |
| `vault_log_event` | Record a custom event |
| `vault_watch` | Schedule auto-updates |

## Routing by Frontmatter

| Field | Value | Target |
|---|---|---|
| `area` | `Work` | `notes/Work/` |
| `area` | `Home` | `notes/Home/` |
| `status` | `archived` | `notes/Archive/` |
| `type` | `daily` | `notes/Archive/` |
| (default) | — | `notes/Home/` |

## Automation

- **Inbox processing**: Scheduled via `com.tars.vault-maintenance` launchd (09:00 + 18:00)
- **Frontmatter repair**: `vault_lint --mode frontmatter --fix` auto-fills title, date, type, status
- **Git backup**: Hourly via `com.tars.git-backup` launchd
- All automation is headless — no human approval required

## 🔄 Auto-Recall

The extension automatically searches `notes/` before every user turn:
1. Extracts key terms from your prompt
2. Searches notes/ for matching pages via frontmatter
3. Injects matching page titles + summaries into context

Use `vault_recall` explicitly for deeper searches if auto-recall is insufficient.

## Workflows

### Inbox Processing

```
For each .md in inbox/:
  1. Read file + extract content
  2. Classify: type, project, tags from content + title
  3. Populate frontmatter: type, status: active, date:, project, tags
  4. Write to notes/ (routed by frontmatter)
  5. Move processed file to inbox/_processed/
  6. On failure → inbox/_failed/ with error log
```

### Quick Capture

```
vault_capture_to_inbox(text="raw capture", title="Quick thought")
→ Later: auto-classified and filed via launchd schedule
```

### Research Notes

```
1. vault_recall(query="topic") → find related notes
2. vault_create_note(type: "learning", title: "...", body: "...") → new note
3. Done — note routed to correct folder and awaits lint cycle
```

### Frontmatter Health Check

```
vault_lint(mode: "frontmatter")
→ Summary of incomplete frontmatter

vault_lint(mode: "frontmatter", fix: true)
→ Auto-fills title, date, type: note, status: active
```

## Page Conventions

### Naming

- `kebab-case.md` for file names
- **Title** in frontmatter can be user-friendly

### Frontmatter

Minimum:
```yaml
---
title: A Clear Title
type: idea | decision | learning | insight | blocker | opportunity | plan
status: draft | inbox | active | waiting | completed | archived
date: YYYY-MM-DD
---
```

Optional:
```yaml
project: project-name
tags: [tag1, tag2]
description: Brief summary (2-3 sentences)
```

### Connections

Every note should end with:
```markdown
## Connections

- [[Related Note]] — relationship
- [[Another Note]] — relationship
```

## Tips

- **Trust auto-recall:** The extension surfaces relevant context without explicit search
- **Don't manage folders:** Frontmatter drives placement — let the tools handle routing
- **Batch efficiently:** Process inbox items in one go via launchd schedule
- **Use vault_lint regularly:** Automated frontmatter repair keeps the vault healthy
