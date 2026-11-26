#!/usr/bin/env python3
"""Tonnetz Lite — zero-dependency local static server.

The app is a plain ES-module web page, so it only needs an HTTP server that
serves this folder. This script binds to loopback, finds a free port, and opens
the default browser. No third-party packages are required.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Tuple

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8850
PORT_ATTEMPTS = 21


class TonnetzServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second process bind the same port, which
    # would silently break the "find the next free port" behavior.
    allow_reuse_address = sys.platform != "win32"
    quiet = False


class RequestHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "TonnetzLite/0.1"

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/api/ping":
            body = json.dumps(
                {"app": "tonnetz-lite", "ok": True}, separators=(",", ":")
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, format: str, *args) -> None:
        if not self.server.quiet:  # type: ignore[attr-defined]
            super().log_message(format, *args)


def find_server(port: int) -> Tuple[TonnetzServer, int]:
    """Bind the first free port in the 8850–8870 range (or a custom start)."""
    handler = functools.partial(RequestHandler, directory=str(ROOT))
    last = min(port + PORT_ATTEMPTS - 1, 65535)
    for candidate in range(port, last + 1):
        try:
            server = TonnetzServer(("127.0.0.1", candidate), handler)
        except OSError:
            continue
        return server, candidate
    raise SystemExit(
        f"没有可用端口（{port}–{last}）。"
        "请先关闭占用端口的程序，或用 --port 指定其他端口。"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="在本机启动 Tonnetz Lite（仅监听 127.0.0.1）。"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"起始端口，默认 {DEFAULT_PORT}；被占用时自动顺延。",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="只启动服务器，不自动打开浏览器。",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="不输出每个 HTTP 请求日志。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not (1 <= args.port <= 65535):
        print("端口必须在 1–65535 之间。", file=sys.stderr)
        return 2
    if not (ROOT / "index.html").is_file():
        print("未找到 index.html，请在 Tonnetz Lite 根目录运行本脚本。", file=sys.stderr)
        return 1

    server, port = find_server(args.port)
    server.quiet = args.quiet
    url = f"http://127.0.0.1:{port}/"

    print("Tonnetz Lite 已启动")
    print(f"地址: {url}")
    print("按 Ctrl+C 停止。")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止…")
    finally:
        server.server_close()
    print("已停止。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
