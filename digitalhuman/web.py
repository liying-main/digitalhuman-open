"""本地 Web 界面（只用标准库）。"""

from __future__ import annotations

import io
import json
import mimetypes
import os
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import config
from .pipeline import run
from .station import StationError

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(os.path.dirname(HERE), "web", "index.html")
WEB_DIR = os.path.dirname(INDEX)

JOBS: dict[str, dict] = {}
LOCK = threading.Lock()


class _JobWriter(io.TextIOBase):
    def __init__(self, job: dict) -> None:
        self.job = job

    def write(self, text: str) -> int:
        for line in text.splitlines():
            line = line.strip()
            if line:
                with LOCK:
                    self.job["log"].append(line)
        return len(text)

    def flush(self) -> None:
        return None


def _run_job(job: dict, options: dict) -> None:
    try:
        result = run(
            topic=options.get("topic") or "",
            script=options.get("script") or "",
            portrait=options.get("portrait") or "",
            audio=options.get("audio") or "",
            voice_ref=options.get("voice_ref") or "",
            out_dir=options.get("out") or "output",
            tts_only=bool(options.get("tts_only")),
            with_subtitles=bool(options.get("subtitles", True)),
            api_key=options.get("api_key") or None,
            base_url=options.get("base_url") or None,
            on_progress=lambda stage, _value: _JobWriter(job).write(f"已完成：{stage}\n"),
        )
        with LOCK:
            job["status"] = "done"
            job["result"] = result
    except StationError as exc:
        with LOCK:
            job["status"] = "error"
            job["error"] = str(exc)
    except Exception as exc:  # noqa: BLE001
        with LOCK:
            job["status"] = "error"
            job["error"] = str(exc)


def make_handler(default_out: str, base_url: str | None = None,
                 api_key: str | None = None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "digitalhuman-open"

        def log_message(self, *args) -> None:
            return None

        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, payload: dict, status: int = 200) -> None:
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def do_GET(self) -> None:  # noqa: N802
            if not self._local_request():
                return
            parsed = urlparse(self.path)
            if parsed.path == "/api/config":
                self._json({"base_url": base_url or config.base_url(),
                            "has_key": bool(api_key or config.api_key())})
                return
            if parsed.path in ("/", "/index.html"):
                if os.path.isfile(INDEX):
                    with open(INDEX, "rb") as handle:
                        self._send(200, handle.read(), "text/html; charset=utf-8")
                else:
                    self._send(404, b"index.html not found", "text/plain; charset=utf-8")
                return
            # 静态资源：品牌 logo、favicon 等（只取文件名，避免路径穿越）
            name = os.path.basename(parsed.path)
            static = os.path.join(WEB_DIR, name)
            if name and os.path.isfile(static):
                ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
                with open(static, "rb") as handle:
                    self._send(200, handle.read(), ctype)
                return
            if parsed.path == "/api/job":
                job_id = (parse_qs(parsed.query).get("id") or [""])[0]
                with LOCK:
                    job = JOBS.get(job_id)
                    payload = dict(job) if job else None
                if payload is None:
                    self._json({"error": "任务不存在"}, 404)
                else:
                    self._json(payload)
                return
            if parsed.path == "/api/download":
                name = (parse_qs(parsed.query).get("name") or [""])[0]
                root = os.path.abspath(default_out)
                target = os.path.abspath(os.path.join(root, os.path.basename(name)))
                if os.path.commonpath([target, root]) != root or not os.path.isfile(target):
                    self._send(404, b"not found", "text/plain; charset=utf-8")
                    return
                with open(target, "rb") as handle:
                    self._send(200, handle.read(), "application/octet-stream")
                return
            self._send(404, b"not found", "text/plain; charset=utf-8")

        def _local_request(self) -> bool:
            allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            if host not in allowed or (origin and origin != f"http://{host}"):
                self._json({"error": "只允许本机页面访问"}, 403)
                return False
            return True

        def do_POST(self) -> None:  # noqa: N802
            if not self._local_request():
                return
            if urlparse(self.path).path != "/api/generate":
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            try:
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("需要 application/json")
                length = int(self.headers.get("Content-Length") or 0)
                if not 0 < length <= 65536:
                    raise ValueError("请求大小不合法")
                raw = self.rfile.read(length).decode("utf-8")
                options = json.loads(raw or "{}")
                if not isinstance(options, dict):
                    raise ValueError("请求必须为对象")
            except (ValueError, UnicodeDecodeError):
                self._json({"error": "请求不是合法 JSON"}, 400)
                return
            options["out"] = default_out
            configured_base = base_url or config.base_url()
            requested_base = options.get("base_url") or configured_base
            if not isinstance(requested_base, str) or urlparse(requested_base).scheme not in ("http", "https"):
                self._json({"error": "服务地址必须为 http(s) URL"}, 400)
                return
            if requested_base.rstrip("/") != configured_base.rstrip("/") and not options.get("api_key"):
                self._json({"error": "更换服务地址后请显式填写该服务的 API Key"}, 400)
                return
            options["base_url"] = requested_base
            options["api_key"] = options.get("api_key") or api_key or None
            if not (options["api_key"] or config.api_key()):
                self._json({"error": "云端生成需要所选服务的 API Key，可到 OpenAPI 获取或使用兼容服务"}, 400)
                return
            if not (options.get("topic") or options.get("script") or options.get("audio")):
                self._json({"error": "至少填写主题、文案或现成配音路径"}, 400)
                return
            job_id = uuid.uuid4().hex[:12]
            job = {"id": job_id, "status": "running", "log": [], "result": {}, "error": ""}
            with LOCK:
                if any(item["status"] == "running" for item in JOBS.values()):
                    self._json({"error": "已有任务正在运行，请完成后再提交"}, 409)
                    return
                JOBS[job_id] = job
            threading.Thread(target=_run_job, args=(job, options), daemon=True).start()
            self._json({"id": job_id})

    return Handler


def serve(port: int = 8757, out_dir: str = "output", base_url: str | None = None,
          api_key: str | None = None) -> None:
    os.makedirs(out_dir, exist_ok=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(out_dir, base_url, api_key))
    url = f"http://127.0.0.1:{port}/"
    print(f"[digitalhuman] Web 界面已启动：{url}")
    print(f"[digitalhuman] {config.BRAND_PRODUCT} 免费开源工具")
    print(f"[digitalhuman] 服务配置：{base_url or config.base_url()}（可更换）")
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[digitalhuman] 已停止")
    finally:
        httpd.server_close()
