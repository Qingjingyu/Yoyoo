#!/usr/bin/env python3
"""
X Fetcher (built-in for Yoyoo)
Reference: https://github.com/Jane-xiaoer/x-fetcher

Usage:
  python fetch_x.py "https://x.com/username/status/1234567890"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

import requests

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def extract_tweet_id(url: str) -> str | None:
    patterns = [
        r"(?:x\.com|twitter\.com)/\w+/status/(\d+)",
        r"(?:x\.com|twitter\.com)/\w+/statuses/(\d+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def fetch_via_fxtwitter(url: str) -> dict[str, Any] | None:
    api_url = re.sub(r"(x\.com|twitter\.com)", "api.fxtwitter.com", url)
    try:
        resp = requests.get(api_url, headers={"User-Agent": UA}, timeout=20)
        if resp.status_code == 200:
            return resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"[x-fetcher] fxtwitter error: {exc}", file=sys.stderr)
    return None


def fetch_via_syndication(tweet_id: str) -> dict[str, Any] | None:
    url = f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&token=0"
    try:
        resp = requests.get(url, headers={"User-Agent": UA}, timeout=15)
        if resp.status_code == 200:
            return resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"[x-fetcher] syndication error: {exc}", file=sys.stderr)
    return None


def extract_article_content(article: dict[str, Any] | None) -> str | None:
    if not article:
        return None
    content_blocks = article.get("content", {}).get("blocks", [])
    paragraphs: list[str] = []
    for block in content_blocks:
        text = str(block.get("text", "")).strip()
        block_type = str(block.get("type", "unstyled"))
        if not text:
            continue
        if block_type == "header-one":
            paragraphs.append(f"# {text}")
        elif block_type == "header-two":
            paragraphs.append(f"## {text}")
        elif block_type == "header-three":
            paragraphs.append(f"### {text}")
        elif block_type == "blockquote":
            paragraphs.append(f"> {text}")
        elif block_type == "unordered-list-item":
            paragraphs.append(f"- {text}")
        elif block_type == "ordered-list-item":
            paragraphs.append(f"1. {text}")
        else:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def format_output(data: dict[str, Any], source: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "source": source,
        "success": True,
        "type": "tweet",
        "content": {},
    }

    if source == "fxtwitter":
        tweet = data.get("tweet", {})
        article = tweet.get("article")

        if article:
            result["type"] = "article"
            result["content"] = {
                "title": article.get("title", ""),
                "preview": article.get("preview_text", ""),
                "full_text": extract_article_content(article),
                "cover_image": article.get("cover_media", {}).get("media_info", {}).get("original_img_url"),
                "author": tweet.get("author", {}).get("name", ""),
                "username": tweet.get("author", {}).get("screen_name", ""),
                "created_at": article.get("created_at", ""),
                "modified_at": article.get("modified_at", ""),
                "likes": tweet.get("likes", 0),
                "retweets": tweet.get("retweets", 0),
                "views": tweet.get("views", 0),
                "bookmarks": tweet.get("bookmarks", 0),
            }
        else:
            result["content"] = {
                "text": tweet.get("text", ""),
                "author": tweet.get("author", {}).get("name", ""),
                "username": tweet.get("author", {}).get("screen_name", ""),
                "created_at": tweet.get("created_at", ""),
                "likes": tweet.get("likes", 0),
                "retweets": tweet.get("retweets", 0),
                "views": tweet.get("views", 0),
                "media": [
                    m.get("url")
                    for m in tweet.get("media", {}).get("all", [])
                    if m.get("url")
                ],
                "replies": tweet.get("replies", 0),
            }

    elif source == "syndication":
        result["content"] = {
            "text": data.get("text", ""),
            "author": data.get("user", {}).get("name", ""),
            "username": data.get("user", {}).get("screen_name", ""),
            "created_at": data.get("created_at", ""),
            "likes": data.get("favorite_count", 0),
            "retweets": data.get("retweet_count", 0),
            "media": [
                m.get("media_url_https")
                for m in data.get("mediaDetails", [])
                if m.get("media_url_https")
            ],
        }

    return result


def fetch_tweet(url: str) -> dict[str, Any]:
    tweet_id = extract_tweet_id(url)
    if not tweet_id:
        return {"success": False, "error": "无法从 URL 提取 tweet ID"}

    data = fetch_via_fxtwitter(url)
    if data and data.get("tweet"):
        return format_output(data, "fxtwitter")

    data = fetch_via_syndication(tweet_id)
    if data and data.get("text"):
        return format_output(data, "syndication")

    return {"success": False, "error": "所有抓取方式均失败"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="抓取 X(Twitter) 内容")
    parser.add_argument("url", help="X/Twitter 帖子 URL")
    parser.add_argument("--compact", action="store_true", help="输出紧凑 JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = fetch_tweet(args.url)
    if args.compact:
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
