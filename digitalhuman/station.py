"""中转站客户端（只用标准库）。

  POST /v1/chat/completions       写口播稿
  POST /v1/audio/speech           文字转语音
  POST /v1/audio/transcriptions   音频转文本
  POST /v1/videos                 形象数字人（异步任务）
  GET  /v1/videos/{id}            查询任务
  GET  /v1/videos/{id}/content    下载成片
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import time
import urllib.error
import urllib.request
import uuid

from . import config


class StationError(RuntimeError):
    """中转站返回的错误，携带 HTTP 状态码与原始响应。"""

    def __init__(self, message: str, status: int = 0, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class StationClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None,
                 timeout: float = 300.0) -> None:
        self.base_url = (base_url or config.base_url()).rstrip("/")
        self.api_key = (api_key or config.api_key()).strip()
        self.chat_api_key = self.api_key if api_key else config.chat_key()
        self.tts_api_key = self.api_key if api_key else config.tts_key()
        self.timeout = timeout

    def _key(self, override: str | None) -> str:
        key = (override or self.api_key).strip()
        if not key:
            raise StationError(
                f"缺少 API Key。请设置 DIGITALHUMAN_API_KEY，或在 {config.STATION_HOME} 创建令牌。"
            )
        return key

    # ------------------------------------------------------------- 基础请求
    def _request(self, path: str, data: bytes | None = None,
                 headers: dict | None = None, method: str | None = None,
                 raw: bool = False, key: str | None = None, timeout: float | None = None):
        req_headers = {"Authorization": "Bearer " + self._key(key)}
        if headers:
            req_headers.update(headers)
        request = urllib.request.Request(
            self.base_url + path, data=data, headers=req_headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout or self.timeout) as resp:
                payload = resp.read()
                if raw:
                    return payload
                return json.loads(payload.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            for secret in (self.api_key, self.chat_api_key, self.tts_api_key):
                if secret:
                    body = body.replace(secret, "[REDACTED]")
            raise StationError(self._explain(exc.code, body), exc.code, body) from None
        except urllib.error.URLError as exc:
            raise StationError(f"无法连接 {self.base_url}：{exc.reason}") from None

    @staticmethod
    def _explain(status: int, body: str) -> str:
        detail = body[:400]
        if status == 503 and "No available channel" in body:
            return ("底座返回 503：当前令牌分组没有该模型的可用渠道。"
                    f"请在 {config.STATION_HOME} 确认令牌分组包含该模型，"
                    f"或用 DIGITALHUMAN_TTS_KEY / DIGITALHUMAN_CHAT_KEY 指定其它令牌。原始响应：{detail}")
        if status == 401:
            return f"底座返回 401：API Key 无效或已过期。原始响应：{detail}"
        if status == 402 or "insufficient" in body.lower():
            return f"底座返回 {status}：额度不足，请充值。原始响应：{detail}"
        return f"底座返回 {status}：{detail}"

    # ----------------------------------------------------------------- 写稿
    def chat(self, messages: list[dict], model: str | None = None,
             temperature: float = 0.8, max_tokens: int = 1024) -> str:
        payload = {
            "model": model or config.chat_model(),
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        result = self._request(
            "/chat/completions", json.dumps(payload).encode("utf-8"),
            {"Content-Type": "application/json"}, key=self.chat_api_key,
        )
        try:
            return result["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise StationError(f"无法解析模型响应：{str(result)[:400]}") from None

    # ----------------------------------------------------------------- 配音
    def tts(self, text: str, voice: str, model: str | None = None,
            response_format: str = "mp3", speed: float = 1.0) -> bytes:
        if not text.strip():
            raise StationError("配音文本为空")
        payload = {
            "model": model or config.tts_model(),
            "input": text,
            "voice": normalize_voice(voice),
            "response_format": response_format,
            "speed": speed,
        }
        return self._request(
            "/audio/speech", json.dumps(payload).encode("utf-8"),
            {"Content-Type": "application/json"}, raw=True, key=self.tts_api_key,
        )

    # ----------------------------------------------------------------- 字幕
    def asr(self, audio_path: str, model: str | None = None,
            language: str = "zh", response_format: str = "srt") -> str:
        if not os.path.isfile(audio_path):
            raise StationError(f"音频文件不存在：{audio_path}")
        body, headers = encode_multipart(
            {"model": model or config.asr_model(), "language": language,
             "response_format": response_format},
            {"file": audio_path},
        )
        if response_format == "json":
            return self._request("/audio/transcriptions", body, headers, key=self.tts_api_key)
        return self._request("/audio/transcriptions", body, headers,
                             raw=True, key=self.tts_api_key).decode("utf-8", "replace")

    # --------------------------------------------------------------- 数字人
    def submit_avatar(self, video_path: str, audio_path: str,
                      model: str | None = None) -> dict:
        for path in (video_path, audio_path):
            if not os.path.isfile(path):
                raise StationError(f"素材不存在：{path}")
        body, headers = encode_multipart(
            {"model": model or config.avatar_model()},
            {"video": video_path, "audio": audio_path},
        )
        # 提交接口会等 GPU 空闲（排队），耗时可能到十几分钟，因此单独放宽超时
        return self._request("/videos", body, headers, timeout=1800.0)

    def get_task(self, task_id: str) -> dict:
        return self._request(f"/videos/{task_id}")

    def download_task(self, task_id: str, out_path: str) -> str:
        blob = self._request(f"/videos/{task_id}/content", raw=True, timeout=900.0)
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "wb") as handle:
            handle.write(blob)
        return out_path

    def wait_avatar(self, task_id: str, on_progress=None) -> dict:
        """轮询任务直到终态。"""
        deadline = time.time() + config.POLL_TIMEOUT_SECONDS
        while time.time() < deadline:
            time.sleep(config.POLL_INTERVAL_SECONDS)
            state = self.get_task(task_id)
            status = str(state.get("status") or "").lower()
            if on_progress:
                on_progress(state)
            if status in ("succeeded", "success", "completed"):
                return state
            if status in ("failed", "error", "cancelled", "canceled"):
                detail = state.get("error") or state.get("message") or state
                raise StationError(f"数字人任务失败：{detail}")
        raise StationError(f"数字人任务超时（{int(config.POLL_TIMEOUT_SECONDS)} 秒）：{task_id}")


# --------------------------------------------------------------- 辅助函数
def normalize_voice(voice: str) -> str:
    voice = (voice or "").strip()
    if not voice:
        raise StationError("缺少音色参考音频（3-10 秒人声）")
    if voice.startswith(("http://", "https://", "data:")):
        return voice
    if not os.path.isfile(voice):
        raise StationError(f"参考音频不存在：{voice}")
    ctype = mimetypes.guess_type(voice)[0] or "audio/wav"
    with open(voice, "rb") as handle:
        encoded = base64.b64encode(handle.read()).decode("ascii")
    return f"data:{ctype};base64,{encoded}"


def encode_multipart(fields: dict, files: dict) -> tuple[bytes, dict]:
    boundary = "----digitalhuman" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n".encode("utf-8")
        )
    for name, path in files.items():
        filename = os.path.basename(path)
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
            f'filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode("utf-8")
        )
        with open(path, "rb") as handle:
            chunks.append(handle.read())
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), {"Content-Type": f"multipart/form-data; boundary={boundary}"}
