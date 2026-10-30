"""集中配置。

OpenAPI 为可选默认服务；地址、模型及凭据可由用户配置。
所有值都可以用环境变量覆盖。
"""

from __future__ import annotations

import os

# ---------------------------------------------------------------- 默认服务
# 品牌
BRAND_NAME = "厉影AI"
BRAND_PRODUCT = "厉影AI 数字人"
BRAND_TAGLINE = "人像 + 文案，云端出片"

STATION_HOME = "https://api.openapi.cn"
DEFAULT_BASE_URL = "https://api.openapi.cn/v1"

# 中转站上的模型名
DEFAULT_CHAT_MODEL = "deepseek-v4.1-flash"
DEFAULT_TTS_MODEL = "indextts2-v1"
DEFAULT_AVATAR_MODEL = "duix-avatar-v1"
DEFAULT_ASR_MODEL = "whisper-large-v3-turbo"

# 轮询参数
POLL_INTERVAL_SECONDS = 6.0
POLL_TIMEOUT_SECONDS = 1800.0


def base_url() -> str:
    return os.environ.get("DIGITALHUMAN_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def brand_name() -> str:
    return os.environ.get("DIGITALHUMAN_BRAND", BRAND_NAME).strip()


def api_key() -> str:
    return (
        os.environ.get("DIGITALHUMAN_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()


def chat_key() -> str:
    return os.environ.get("DIGITALHUMAN_CHAT_KEY", "").strip() or api_key()


def tts_key() -> str:
    return os.environ.get("DIGITALHUMAN_TTS_KEY", "").strip() or api_key()


def chat_model() -> str:
    return os.environ.get("DIGITALHUMAN_CHAT_MODEL", DEFAULT_CHAT_MODEL).strip()


def tts_model() -> str:
    return os.environ.get("DIGITALHUMAN_TTS_MODEL", DEFAULT_TTS_MODEL).strip()


def avatar_model() -> str:
    return os.environ.get("DIGITALHUMAN_AVATAR_MODEL", DEFAULT_AVATAR_MODEL).strip()


def asr_model() -> str:
    return os.environ.get("DIGITALHUMAN_ASR_MODEL", DEFAULT_ASR_MODEL).strip()
