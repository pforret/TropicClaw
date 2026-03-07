---
name: jina-reader
description: >
  Fetch clean web page content as Markdown using the Jina Reader API. Strips away
  navigation, ads, sidebars, and boilerplate, returning only the main article content.
  Use when the user asks to: (1) grab/fetch/read a web page's content, (2) convert a
  URL to Markdown, (3) extract article text from a URL, (4) download a page without
  clutter, or (5) scrape readable content from a website. Also use when Claude needs
  to read web content for research, summarization, or analysis tasks.
---

# Jina Reader

Fetch clean Markdown content from any web page via the [Jina Reader API](https://r.jina.ai).

## Quick Usage

### Via script

```bash
python3 scripts/jina_fetch.py "https://example.com/article"
```

Options:
- `-o FILE` — save to file instead of stdout
- `--with-images` — include image descriptions
- `--with-links` — append a links summary
- `--json` — return JSON with metadata (title, description, etc.)
- `-t SECONDS` — timeout (default: 30)

### Via curl (no dependencies)

```bash
curl -s "https://r.jina.ai/https://example.com/article"
```

### Via WebFetch tool

Use the WebFetch tool with `https://r.jina.ai/<URL>` as the URL parameter.

## Saving Output

```bash
python3 scripts/jina_fetch.py "https://example.com" -o article.md
```

## API Headers

| Header                       | Effect                                                           |
|------------------------------|------------------------------------------------------------------|
| `X-With-Images: true`        | Include image alt-text/descriptions                              |
| `X-With-Links-Summary: true` | Append list of all links found                                   |
| `Accept: application/json`   | Return JSON with `title`, `description`, `content`, `url` fields |

## Notes

- Free for moderate use; no API key required.
- Works best on article/blog pages. May return less useful results for SPAs or heavily JS-rendered pages.
