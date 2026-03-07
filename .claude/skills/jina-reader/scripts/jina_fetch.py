#!/usr/bin/env python3
"""Fetch clean web page content as Markdown via Jina Reader API."""

import argparse
import json
import sys
import urllib.request
import urllib.error


def fetch(url: str, *, timeout: int = 30, headers: dict | None = None) -> str:
    """Fetch URL content as Markdown via Jina Reader API.

    Args:
        url: The web page URL to fetch.
        timeout: Request timeout in seconds.
        headers: Optional extra headers (e.g. X-With-Images, X-With-Links-Summary).

    Returns:
        Clean Markdown content of the page.
    """
    api_url = f"https://r.jina.ai/{url}"
    req_headers = {
        "Accept": "text/markdown",
        "User-Agent": "Mozilla/5.0 (compatible; JinaReader/1.0)",
    }
    if headers:
        req_headers.update(headers)

    req = urllib.request.Request(api_url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        print(f"Error: HTTP {e.code} fetching {url}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Error: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Fetch web page content as Markdown via Jina Reader API")
    parser.add_argument("url", help="URL of the web page to fetch")
    parser.add_argument("-o", "--output", help="Output file path (default: stdout)")
    parser.add_argument("-t", "--timeout", type=int, default=30, help="Timeout in seconds (default: 30)")
    parser.add_argument("--with-images", action="store_true", help="Include image descriptions")
    parser.add_argument("--with-links", action="store_true", help="Include links summary")
    parser.add_argument("--json", action="store_true", dest="json_mode", help="Request JSON response with metadata")
    args = parser.parse_args()

    headers = {}
    if args.with_images:
        headers["X-With-Images"] = "true"
    if args.with_links:
        headers["X-With-Links-Summary"] = "true"
    if args.json_mode:
        headers["Accept"] = "application/json"

    content = fetch(args.url, timeout=args.timeout, headers=headers)

    if args.json_mode:
        try:
            data = json.loads(content)
            content = json.dumps(data, indent=2, ensure_ascii=False)
        except json.JSONDecodeError:
            pass

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(content)


if __name__ == "__main__":
    main()
