"""数字人流水线：写稿 → 配音 → 口型视频 → 字幕。"""

from __future__ import annotations

import os
import re
import time

from . import config
from .station import StationClient, StationError

SCRIPT_SYSTEM = """你是口播稿撰稿人。根据用户给的主题写一段口播稿。
要求：口语化、有钩子、60-160 字，直接输出正文，不要标题、不要分镜、不要任何解释。"""


def _safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()[:40] or "output"


def log(message: str) -> None:
    print(f"[digitalhuman] {message}", flush=True)


def write_script(client: StationClient, topic: str) -> str:
    """用中转站写口播稿。"""
    log("写口播稿…")
    text = client.chat(
        [
            {"role": "system", "content": SCRIPT_SYSTEM},
            {"role": "user", "content": f"主题：{topic}"},
        ],
        temperature=0.9,
        max_tokens=800,
    ).strip()
    if not text:
        raise StationError("模型没有返回文案")
    return text


def run(topic: str = "", script: str = "", portrait: str = "", audio: str = "",
        voice_ref: str = "", out_dir: str = "output", make_video: bool = True,
        tts_only: bool = False, with_subtitles: bool = True,
        api_key: str | None = None, base_url: str | None = None,
        on_progress=None) -> dict:
    """跑完整流程，返回产出文件路径。"""
    # 在任何云端调用前检查必要素材，避免缺文件时先消耗写稿/配音额度。
    if audio.strip():
        if not os.path.isfile(audio.strip()):
            raise StationError(f"配音文件不存在：{audio}")
    elif not voice_ref.strip() or not os.path.isfile(voice_ref.strip()):
        raise StationError("生成配音需要有效的 --voice-ref 参考音频文件")
    if make_video and not tts_only and (not portrait.strip() or not os.path.isfile(portrait.strip())):
        raise StationError("生成数字人视频需要有效的 --portrait 人像素材文件")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    client = StationClient(base_url=base_url, api_key=api_key)
    result: dict = {"script": "", "voiceover": "", "video": "", "subtitle": ""}

    # 1. 文案
    if script.strip():
        text = script.strip()
    elif topic.strip():
        text = write_script(client, topic)
    elif audio.strip():
        text = ""
    else:
        raise StationError("需要 --topic、--script 或 --audio 之一")
    result["script"] = text
    log(f"文案 {len(text)} 字：{text[:40]}…")
    if on_progress:
        on_progress("script", text)

    # 2. 配音
    if audio.strip():
        voiceover = audio.strip()
        if not os.path.isfile(voiceover):
            raise StationError(f"配音文件不存在：{voiceover}")
        log(f"使用现成配音：{voiceover}")
    else:
        if not voice_ref.strip():
            raise StationError("生成配音需要 --voice-ref（3-10 秒参考音频）")
        log("合成配音（indextts2-v1）…")
        blob = client.tts(text, voice_ref)
        voiceover = os.path.join(out_dir, f"voice_{stamp}.mp3")
        with open(voiceover, "wb") as handle:
            handle.write(blob)
        log(f"配音已保存：{voiceover}（{len(blob)} 字节）")
    result["voiceover"] = voiceover
    if on_progress:
        on_progress("voiceover", voiceover)

    # 3. 字幕（可选）
    if with_subtitles:
        try:
            log("生成字幕（whisper-large-v3-turbo）…")
            srt = client.asr(voiceover, response_format="srt")
            subtitle = os.path.join(out_dir, f"voice_{stamp}.srt")
            with open(subtitle, "w", encoding="utf-8") as handle:
                handle.write(srt)
            result["subtitle"] = subtitle
            log(f"字幕已保存：{subtitle}")
        except StationError as exc:
            log(f"字幕生成跳过：{exc}")

    if tts_only:
        return result

    # 4. 口型视频
    if not make_video:
        return result
    if not portrait.strip():
        raise StationError("生成数字人视频需要 --portrait（人像素材）")
    if not os.path.isfile(portrait):
        raise StationError(f"人像素材不存在：{portrait}")

    log("提交数字人任务（duix-avatar-v1）…")
    task = client.submit_avatar(portrait, voiceover)
    task_id = str(task.get("id") or task.get("task_id") or "")
    if not task_id:
        raise StationError(f"提交任务失败，响应：{str(task)[:300]}")
    log(f"任务已提交：{task_id}（status={task.get('status')}）")
    if on_progress:
        on_progress("task", task_id)

    def _progress(state: dict) -> None:
        log(f"任务状态：{state.get('status')} {state.get('progress') or ''}".strip())

    final_state = client.wait_avatar(task_id, on_progress=_progress)
    log(f"任务完成：{final_state.get('status')}")

    video_path = os.path.join(out_dir, f"avatar_{stamp}.mp4")
    client.download_task(task_id, video_path)
    result["video"] = video_path
    log(f"成片已保存：{video_path}")
    if on_progress:
        on_progress("video", video_path)
    return result

