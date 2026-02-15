#!/usr/bin/env python3
"""
WeChat Official Account Learning Helper (built-in for Yoyoo)

Capabilities:
1) Search public WeChat articles by keyword (no API key)
2) Fetch article core text from mp.weixin.qq.com URL
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def _http_get(url: str, timeout: int = 20, referer: str | None = None) -> str:
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read().decode("utf-8", errors="ignore")


def _clean_html_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value).strip()


def _parse_sogou_articles(html_text: str, limit: int) -> list[dict]:
    items: list[dict] = []
    blocks = re.findall(r"<li id=\"sogou_vr_11002601_box_\d+\"[\s\S]*?</li>", html_text)

    for block in blocks:
        title_match = re.search(r'<a[^>]+id=\"sogou_vr_11002601_title_\d+\"[^>]*>([\s\S]*?)</a>', block)
        link_match = re.search(r'<a[^>]*id=\"sogou_vr_11002601_title_\d+\"[^>]*href=\"([^\"]+)\"', block)
        if not link_match:
            link_match = re.search(r'<a[^>]*href=\"([^\"]+)\"[^>]*id=\"sogou_vr_11002601_title_\d+\"', block)
        summary_match = re.search(r'<p class=\"txt-info\"[^>]*>([\s\S]*?)</p>', block)
        source_match = re.search(r'<span class=\"all-time-y2\">([\s\S]*?)</span>', block)
        ts_match = re.search(r"timeConvert\('(\d+)'\)", block)

        if not (title_match and link_match):
            continue

        raw_link = html.unescape(link_match.group(1).strip())
        if raw_link.startswith("/"):
            raw_link = "https://weixin.sogou.com" + raw_link

        pub = ""
        if ts_match:
            try:
                pub = dt.datetime.fromtimestamp(int(ts_match.group(1))).isoformat()
            except ValueError:
                pub = ""

        items.append(
            {
                "title": _clean_html_text(title_match.group(1)),
                "link": raw_link,
                "description": _clean_html_text(summary_match.group(1)) if summary_match else "",
                "account_hint": _clean_html_text(source_match.group(1)) if source_match else "",
                "pubDate": pub,
            }
        )

        if len(items) >= limit:
            break

    return items


def _search_sogou(keyword: str, limit: int) -> list[dict]:
    base = "https://weixin.sogou.com/weixin?type=2&query="
    query_url = base + urllib.parse.quote(keyword)
    html_text = _http_get(query_url, referer="https://weixin.sogou.com/")
    return _parse_sogou_articles(html_text, limit)


def _search_bing_rss(keyword: str, limit: int) -> list[dict]:
    query = f"site:mp.weixin.qq.com {keyword}"
    url = "https://www.bing.com/search?format=rss&q=" + urllib.parse.quote(query)
    xml_text = _http_get(url)
    root = ET.fromstring(xml_text)
    items: list[dict] = []

    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        desc = (item.findtext("description") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        if "mp.weixin.qq.com" not in link:
            continue
        items.append(
            {
                "title": html.unescape(title),
                "link": link,
                "description": html.unescape(desc),
                "account_hint": "",
                "pubDate": pub,
            }
        )
        if len(items) >= limit:
            break

    return items


def search_articles(keyword: str, limit: int = 10) -> dict:
    items = _search_sogou(keyword, limit)
    source = "sogou-weixin"

    if not items:
        items = _search_bing_rss(keyword, limit)
        source = "bing-rss-fallback"

    return {
        "success": True,
        "source": source,
        "query": keyword,
        "count": len(items),
        "items": items,
        "notice": "sogou 链接可能触发反爬验证，必要时可手动在浏览器打开。",
    }


def _strip_tags(content: str) -> str:
    content = re.sub(r"<script[\s\S]*?</script>", "", content, flags=re.I)
    content = re.sub(r"<style[\s\S]*?</style>", "", content, flags=re.I)
    content = re.sub(r"<[^>]+>", "", content)
    content = html.unescape(content)
    content = re.sub(r"[ \t]+", " ", content)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()


def fetch_article(url: str) -> dict:
    if "mp.weixin.qq.com" not in url:
        return {"success": False, "error": "仅支持 mp.weixin.qq.com 链接"}

    raw = _http_get(url, timeout=30)

    title = ""
    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', raw)
    if m:
        title = html.unescape(m.group(1).strip())
    if not title:
        m = re.search(r"<title>(.*?)</title>", raw, flags=re.I | re.S)
        title = html.unescape(m.group(1).strip()) if m else ""

    account = ""
    m = re.search(r'var\s+nickname\s*=\s*htmlDecode\("([^"]*)"\)', raw)
    if m:
        account = html.unescape(m.group(1).strip())

    content_html = ""
    m = re.search(r'<div[^>]+id="js_content"[^>]*>([\s\S]*?)</div>\s*<script', raw, flags=re.I)
    if m:
        content_html = m.group(1)

    text = _strip_tags(content_html) if content_html else ""

    return {
        "success": True,
        "source": "mp.weixin.qq.com",
        "url": url,
        "title": title,
        "account": account,
        "text": text,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="公众号搜索与学习")
    sub = parser.add_subparsers(dest="cmd", required=True)

    s1 = sub.add_parser("search", help="按关键词搜索公众号文章")
    s1.add_argument("keyword", help="关键词")
    s1.add_argument("-n", "--limit", type=int, default=10, help="返回数量")

    s2 = sub.add_parser("fetch", help="抓取单篇公众号文章正文")
    s2.add_argument("url", help="mp.weixin.qq.com 文章链接")

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.cmd == "search":
        result = search_articles(args.keyword, limit=args.limit)
    else:
        result = fetch_article(args.url)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
