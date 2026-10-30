"""命令行入口：python -m digitalhuman --topic "主题" --portrait 人像.mp4 """

from __future__ import annotations

import argparse
import sys

from . import config
from .pipeline import run
from .station import StationError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="digitalhuman",
        description=f"{config.BRAND_PRODUCT} 免费开源工具",
    )
    parser.add_argument("--topic", "-t", default="", help="主题，交给模型写口播稿")
    parser.add_argument("--script", "-s", default="", help="直接给文案，跳过模型写稿")
    parser.add_argument("--portrait", "-p", default="", help="人像素材（mp4/mov/webm/mkv/avi）")
    parser.add_argument("--audio", "-a", default="", help="现成配音文件，跳过 TTS")
    parser.add_argument("--voice-ref", default="", help="参考音频（3-10 秒人声），用于克隆音色")
    parser.add_argument("--out", default="output", help="输出目录")
    parser.add_argument("--tts-only", action="store_true", help="只合成配音")
    parser.add_argument("--no-subtitles", action="store_true", help="不生成字幕")
    parser.add_argument("--api-key", default="", help="覆盖 DIGITALHUMAN_API_KEY")
    parser.add_argument("--base-url", default="", help="覆盖所选服务地址")
    parser.add_argument("--web", action="store_true", help="启动本地 Web 界面")
    parser.add_argument("--port", type=int, default=8757, help="Web 界面端口")
    parser.add_argument("--check", action="store_true", help="发起云端请求验证 Key，可能消耗服务端额度")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.web:
        from .web import serve
        serve(port=args.port, out_dir=args.out,
              base_url=args.base_url or None, api_key=args.api_key or None)
        return 0

    if args.check:
        from .station import StationClient
        print(f"{config.BRAND_PRODUCT} 免费开源工具")
        print(f"服务地址：{args.base_url or config.base_url()}")
        print(f"写稿：{config.chat_model()}｜配音：{config.tts_model()}｜"
              f"数字人：{config.avatar_model()}｜字幕：{config.asr_model()}")
        try:
            client = StationClient(base_url=args.base_url or None,
                                   api_key=args.api_key or None)
        except StationError as exc:
            print(f"配置不可用 —— {exc}")
            return 1
        ok = True
        try:
            reply = client.chat(
                [{"role": "user", "content": "回复两个字：正常"}], max_tokens=16
            )
            print(f"对话接口：可用（模型回复：{reply.strip()[:20]}）")
        except StationError as exc:
            print(f"对话接口：不可用 —— {exc}")
            ok = False
        try:
            client._request("/models", key=client.tts_api_key)
            print("模型列表：可读取")
        except StationError as exc:
            print(f"模型列表：不可用 —— {exc}")
            ok = False
        return 0 if ok else 1

    try:
        print(f"{config.BRAND_PRODUCT} 免费开源工具")
        print("云端功能按所选服务的额度和规则执行。\n")
        result = run(
            topic=args.topic,
            script=args.script,
            portrait=args.portrait,
            audio=args.audio,
            voice_ref=args.voice_ref,
            out_dir=args.out,
            tts_only=args.tts_only,
            with_subtitles=not args.no_subtitles,
            api_key=args.api_key or None,
            base_url=args.base_url or None,
        )
    except StationError as exc:
        print(f"\n[错误] {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"\n[错误] {exc}")
        return 1

    print("\n产出：")
    for key in ("voiceover", "subtitle", "video"):
        if result.get(key):
            print(f"  {key}: {result[key]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
