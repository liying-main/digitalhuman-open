<div align="center">

<img src="web/logo.png" width="96" alt="厉影AI" />

# 厉影AI 数字人 · 免费开源工具

人像素材 + 文案或现成配音 → 口型视频，可选写稿、配音与 SRT 字幕。

</div>

软件按 MIT 许可免费使用、修改和分发。AI 写稿、配音、语音识别和视频渲染由所选云端服务执行，本地无需 GPU；项目不包含本地数字人推理模型。

## 安装与首次使用

安装 Python 3.10+，在项目目录运行。Python 部分仅使用标准库，无需 `pip install`。

```powershell
cd digitalhuman-open
python -m digitalhuman --web
```

打开本机页面 `http://127.0.0.1:8757`，在“云端服务配置”中填写地址与 Key，准备人像视频和参考音频，然后输入文案并生成。页面中的文件路径是本机路径。首次建议使用简短文案确认服务兼容性。

默认连接的 [OpenAPI](https://api.openapi.cn) 是本项目维护团队提供的可选云端服务，可在其站点获取 Key，也可改成其他兼容服务。**软件免费不代表云端调用免费**：云端按所选服务的实时价格、额度和规则执行；如有体验额度，以服务端公布为准，项目不承诺赠送额度。

## 命令行用法

在当前终端配置 Key，不把真实 Key 写入脚本或项目文件。

```powershell
$env:DIGITALHUMAN_API_KEY="你的服务Key"

# 主题 → 写稿 → 配音 → 视频
python -m digitalhuman --topic "新品发布口播" --portrait .\assets\portrait.mp4 --voice-ref .\assets\ref.wav

# 已有文案，跳过写稿
python -m digitalhuman --script "大家好，今天介绍一款新产品。" --portrait .\assets\portrait.mp4 --voice-ref .\assets\ref.wav

# 现成配音直接做口型视频；跳过写稿、配音与字幕调用
python -m digitalhuman --portrait .\assets\portrait.mp4 --audio .\voice.mp3 --no-subtitles

# 只合成配音
python -m digitalhuman --script "测试文本" --voice-ref .\assets\ref.wav --tts-only --no-subtitles

# 自定义输出目录
python -m digitalhuman --web --out .\my-output
```

默认输出到 `output/`，包含生成的 MP3、MP4 和可选 SRT。现成配音保持原路径。SRT 是独立文件，未自动烧录进视频。云端任务为异步提交、轮询后下载；界面出错或关闭客户端不等于服务端任务取消，请在所选服务查看状态。

`python -m digitalhuman --check` 会真实调用写稿和模型接口，可能消耗额度，不属于离线检查。

## 自定义服务与模型

Web 支持填写 API 地址，CLI 支持 `--base-url`。模型名从环境变量读取，请按所选服务实际提供的模型修改，再启动程序。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DIGITALHUMAN_BASE_URL` | `https://api.openapi.cn/v1` | 服务地址 |
| `DIGITALHUMAN_API_KEY` | 空 | 默认 Key，数字人调用需要 |
| `DIGITALHUMAN_CHAT_MODEL` | `deepseek-v4.1-flash` | 写稿模型 |
| `DIGITALHUMAN_TTS_MODEL` | `indextts2-v1` | 配音模型 |
| `DIGITALHUMAN_AVATAR_MODEL` | `duix-avatar-v1` | 数字人模型 |
| `DIGITALHUMAN_ASR_MODEL` | `whisper-large-v3-turbo` | 字幕模型 |
| `DIGITALHUMAN_CHAT_KEY` | 默认 Key | 可选写稿专用 Key |
| `DIGITALHUMAN_TTS_KEY` | 默认 Key | 可选配音和字幕专用 Key |

```powershell
$env:DIGITALHUMAN_BASE_URL="https://your-provider.example/v1"
$env:DIGITALHUMAN_CHAT_MODEL="该服务的模型名"
python -m digitalhuman --web
```

显式在 Web 或 CLI 提供的 Key 优先于环境变量，统一用于该次任务；留空时使用本机环境配置。Web 更换地址后须填写对应服务的 Key。完整流程需要 `/chat/completions`、支持参考音频的 `/audio/speech`、`/audio/transcriptions` 和 `/videos` 任务/下载接口，具体参数见 [digitalhuman/station.py](digitalhuman/station.py)。仅兼容聊天的服务无法完成数字人任务。

## 素材与数据

- 人像素材使用清晰正脸视频；参考音频建议 3–10 秒清晰人声。格式、时长限制以所选服务为准。
- 使用有权处理的人像、声音及其他素材。云端功能会把相应文案、音频或人像发送到所选 API 地址。
- Python/Web 不持久化 Key，不写入浏览器存储或配置文件。`/api/config` 仅返回是否已配置；接口错误会遮盖已知 Key。项目未加入遥测或后台推广请求。
- Web 仅监听本机 `127.0.0.1`，不适合作为公网多人服务，请勿直接转发端口。输出与中间文件保存在本机，自行管理保留时间。

## Electron 桌面客户端源码

仓库另含 `src/`、`build/` 与 `package.json` 的 Electron 界面，可配置模型、选择文件与查看成片。Python/Web 是无需 Node 依赖的独立入口。

```powershell
npm install
npm start
npm run dist
```

桌面配置在系统用户数据目录，Key 使用 Electron `safeStorage` 加密；系统加密不可用时拒绝明文保存。旧版明文配置在支持加密时迁移。桌面依赖和安装包需在目标系统另行构建验证，离线测试不代表云端模型已联调。

## 开发验证

```powershell
python -m unittest discover -s tests -v
node --test tests/*.test.js
```

测试使用临时目录、模拟云端与本机 HTTP 服务，不调用收费 API。许可见 [LICENSE](LICENSE)。

## 相关开源项目

- [数字人桌面版 / 口播智能体](https://github.com/liying-main/liying_ai)
- [数字人轻量版](https://github.com/liying-main/digitalhuman-open)
- [混剪桌面版](https://github.com/liying-main/liying-videomix)
- [混剪轻量版](https://github.com/liying-main/videomix-open)
