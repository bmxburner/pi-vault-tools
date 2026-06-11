# @zosmaai/pi-llm-wiki

[![CI](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zosmaai/pi-llm-wiki)](https://www.npmjs.com/package/@zosmaai/pi-llm-wiki)
[![npm downloads](https://img.shields.io/npm/dm/@zosmaai/pi-llm-wiki)](https://www.npmjs.com/package/@zosmaai/pi-llm-wiki)
[![Coverage](https://codecov.io/gh/zosmaai/pi-llm-wiki/branch/main/graph/badge.svg)](https://codecov.io/gh/zosmaai/pi-llm-wiki)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CodeQL](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/codeql.yml/badge.svg)](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/codeql.yml)

**Self-maintaining, Obsidian-compatible knowledge base for [pi](https://pi.dev).**
Follows Andrej Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

Turn raw sources (URLs, PDFs, markdown, JSON, XML) into a durable, interlinked, LLM-maintained wiki that compounds over time.

---

## Quick Start

```bash
pi install npm:@zosmaai/pi-llm-wiki
```

```
/wiki-init "AI Engineering"
/wiki-ingest
/wiki-query What are the key patterns?
```

---

## Why This Package?

Most file-based LLM workflows behave like one-shot RAG: the model searches raw documents every time you ask a question. Synthesis is ephemeral.

**pi-llm-wiki** creates a middle layer:

- **Raw source packets** preserve source-of-truth inputs
- **Source pages** summarize what each source says
- **Canonical wiki pages** track what the wiki currently believes
- **Generated metadata** keeps everything searchable and navigable

The result is a wiki that **compounds** as you capture sources, ask questions, and file durable analyses.

---

## Features

| Capability | Description |
|------------|-------------|
| 🔗 **Immutable source capture** | URLs, local files (PDF/md/txt/html/XML/JSON), or pasted text → structured source packets |
| 🧠 **Automated ingestion** | `wiki_ingest` batch-processes sources into concept, entity, synthesis & analysis pages |
| 🔍 **Full-text search** | Generated registry with keyword lookup across all pages and sources |
| 🩺 **Mechanical linting** | Orphans, broken links, duplicate aliases, coverage gaps, stale captures |
| 📊 **Dashboard** | `wiki_status` — counts, source states, recent activity |
| 🤖 **Auto-update watch** | `wiki_watch` — schedule periodic discovery + ingest |
| 📝 **Obsidian-friendly** | Folder-qualified wikilinks, stable source-ID citations, compatible vault |
| 🛡️ **Guardrails** | Blocks direct edits to raw sources and generated metadata |
| 🔧 **Configurable PDF extraction** | MarkItDown timeout via `WIKI_MARKITDOWN_TIMEOUT_MS` env var |
| 🧪 **38+ tests, CI, CodeQL** | TypeScript, Vitest, Biome, Codecov |

---

## Tools

| Tool | Description |
|------|-------------|
| `wiki_bootstrap` | Initialize a new wiki vault with config, templates, schema, and metadata |
| `wiki_capture_source` | Capture a URL, local file, or pasted text into an immutable source packet |
| `wiki_ingest` | Process uningested source packets into wiki pages (batch) |
| `wiki_ensure_page` | Resolve or safely create entity / concept / synthesis / analysis pages |
| `wiki_search` | Search the generated wiki registry |
| `wiki_lint` | Deterministic health checks (orphans, gaps, contradictions, auto-fix) |
| `wiki_status` | Show counts, source states, and recent activity |
| `wiki_rebuild_meta` | Force a full metadata rebuild (registry, backlinks, index, log) |
| `wiki_log_event` | Append a structured event to the wiki activity log |
| `wiki_watch` | Schedule automatic wiki updates (daily / weekly / hourly) |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/wiki-status` | Show a concise operational summary |
| `/wiki-lint [mode]` | Run mechanical lint (`all`, `links`, `orphans`, `frontmatter`, `duplicates`, `coverage`, `staleness`) |
| `/wiki-rebuild` | Force a full metadata rebuild |

---

## Quick Start (Detailed)

### 1) Create a new wiki

```bash
mkdir my-wiki
cd my-wiki
pi
```

Ask pi:

```
Initialize an llm wiki here for AI research.
```

This calls `wiki_bootstrap` and creates:

```
raw/
wiki/
meta/
.wiki/
WIKI_SCHEMA.md
```

### 2) Capture a source

```
Capture this article into the wiki: https://example.com/some-article
```

```
Capture this PDF into the wiki: ./papers/context-windows.pdf
```

```
Capture these notes into the wiki: ...pasted text...
```

### 3) Integrate the source

1. Capture the source
2. Read `wiki/sources/SRC-*.md`
3. Update that source page
4. Search for impacted canonical pages with `wiki_search`
5. Create missing pages with `wiki_ensure_page`
6. Update concept / entity / synthesis pages with citations
7. Mark the integration with `wiki_log_event kind=integrate`

### 4) Query the wiki

```
Based on the wiki, what are the main tradeoffs between long-context models and RAG?
```

By default, query mode is **read-only**. To file a durable answer:

```
Answer the question and file the result as an analysis page.
```

---

## Vault Layout

```
my-wiki/
├─ raw/
│  └─ sources/
│     └─ SRC-2026-05-11-001/
│        ├─ manifest.json
│        ├─ original/           # Original artifact
│        ├─ extracted.md        # Normalized text
│        └─ attachments/
├─ wiki/
│  ├─ sources/                  # Source pages (what each source says)
│  ├─ concepts/                 # Concepts and recurring ideas
│  ├─ entities/                 # People, orgs, products, papers, systems
│  ├─ syntheses/                # Cross-source theses and tensions
│  └─ analyses/                 # Durable filed answers from queries
├─ meta/
│  ├─ registry.json             # Auto-generated search index
│  ├─ backlinks.json
│  ├─ index.md
│  ├─ events.jsonl              # Append-only event log
│  ├─ log.md
│  └─ lint-report.md
├─ .wiki/
│  ├─ config.json
│  └─ templates/
└─ WIKI_SCHEMA.md
```

### Ownership Model

| Path | Owner | Rule |
|------|-------|------|
| `raw/**` | Extension tools | Immutable after capture |
| `wiki/**` | Model + user | Editable knowledge pages |
| `meta/registry.json` | Extension | Generated |
| `meta/backlinks.json` | Extension | Generated |
| `meta/index.md` | Extension | Generated |
| `meta/events.jsonl` | Extension / tool | Append-only |
| `meta/log.md` | Extension | Generated from events |
| `meta/lint-report.md` | Extension | Generated |
| `WIKI_SCHEMA.md` | Human + explicit request | Operating manual |

---

## Linking & Citation Style

### Internal Navigation

```markdown
[[concepts/retrieval-augmented-generation]]
[[entities/openai|OpenAI]]
[[syntheses/long-context-vs-rag]]
```

### Factual Citations

```markdown
[[sources/SRC-2026-04-04-001|SRC-2026-04-04-001]]
```

Stable source-page IDs keep provenance stable even if titles change.

---

## Guardrails

The extension **blocks** direct tool-call edits to:

- `raw/**` — immutable source artifacts
- `meta/registry.json`
- `meta/backlinks.json`
- `meta/events.jsonl`
- `meta/index.md`
- `meta/log.md`
- `meta/lint-report.md`

If the model directly edits `wiki/**` using Pi's built-in `write` or `edit` tools, the extension **automatically rebuilds** generated metadata at the end of the agent turn.

---

## Source Packet Format

Each captured source is stored as a structured packet:

```
raw/sources/SRC-YYYY-MM-DD-NNN/
├─ manifest.json     # Capture metadata (title, URL, format, timestamp)
├─ original/         # Original artifact (preserved as-is)
├─ extracted.md      # Normalized text (PDF→md, XML→md, JSON→md, etc.)
└─ attachments/      # Future attachment downloads
```

This preserves both the **original artifact** and a **normalized extracted view** for reading.

---

## Skill Behavior

The bundled `llm-wiki` skill teaches the model to:

- ❌ Never edit raw sources directly
- ❌ Never edit generated metadata files
- ✅ Capture first, integrate second
- ✅ Search before creating new canonical pages
- ✅ Cite facts using source-page IDs
- ✅ Keep query mode read-only by default
- ✅ Use "Tensions / caveats" and "Open questions" when evidence is mixed

---

## Architecture

Four layers with clear ownership:

```
raw/sources/SRC-*/     # Immutable source packets (extension-owned)
wiki/                   # Editable knowledge pages (you + LLM)
meta/                   # Auto-generated registry, backlinks, index, log
.wiki/                  # Config and templates
```

Read [docs/architecture.md](docs/architecture.md) for the full design document.

---

## Documentation

| Document | What it covers |
|----------|---------------|
| [Architecture](docs/architecture.md) | How the four layers work, ownership model |
| [Commands](docs/commands.md) | All slash commands and tool reference |
| [Obsidian Integration](docs/obsidian.md) | Vault setup and recommended plugins |
| [Configuration](docs/configuration.md) | Wiki modes, topics, environment variables |
| [API](docs/api.md) | Extension tool parameter reference |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, test patterns, and PR workflow.

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zosmaai/pi-llm-wiki&type=Date)](https://star-history.com/#zosmaai/pi-llm-wiki&Date)

## Contributors

<a href="https://github.com/zosmaai/pi-llm-wiki/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zosmaai/pi-llm-wiki" alt="Contributors" />
</a>

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/zosmaai">zosmaai</a> · </sub>
  <a href="https://pi.dev">pi.dev</a> · <a href="https://github.com/zosmaai/pi-llm-wiki/issues">Issues</a>
</div>

## License

MIT
