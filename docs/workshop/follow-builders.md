# Follow Builders — AI 建造者日报

> 追踪建造者，而非网红。一个 AI 驱动的信息聚合工具，追踪 AI 领域最顶尖的建造者（研究员、创始人、PM、工程师），并将他们的最新动态整理成摘要推送给你。

- 项目地址：[zarazhangrui/follow-builders](https://github.com/zarazhangrui/follow-builders)
- 无需任何 API Key，开箱即用

---

## 功能介绍

每日或每周推送到你常用的通讯工具（Telegram、邮件）或直接在聊天中显示，内容包含：

- 5 个顶级 AI 播客的精华摘要（Latent Space、No Priors 等）
- 25 位精选 AI 建造者在 X/Twitter 上的关键观点（Andrej Karpathy、Sam Altman 等）
- Anthropic Engineering 和 Claude Blog 的官方博客文章
- 所有原始内容链接
- 支持英文、中文或双语

---

## 安装（Claude Code）

```bash
git clone https://github.com/zarazhangrui/follow-builders.git ~/.claude/skills/follow-builders
cd ~/.claude/skills/follow-builders/scripts && npm install
```

安装完成后，重新启动 Claude Code，skill 会自动加载。

---

## 快速开始

在 Claude Code 中输入以下任意一种方式触发：

```
set up follow builders
```

或执行：

```
/follow-builders
```

Agent 会以对话方式引导你完成初始配置：

1. **推送频率** — 每日 or 每周
2. **推送时间和时区** — 例如 "每天早上 8 点，北京时间"
3. **推送方式** — Telegram、邮件，或仅在聊天中显示（按需触发）

---

## 按需获取摘要

不想设置自动推送？随时输入以下命令获取最新摘要：

```
/ai
```

---

## 设置 Telegram 推送（可选）

若需自动定时推送，推荐使用 Telegram：

1. 打开 Telegram，搜索 `@BotFather`
2. 发送 `/newbot`，为 bot 取名（用户名必须以 `bot` 结尾）
3. 获取 Token，格式如：`7123456789:AAH...`
4. 打开你创建的 bot，**先发送一条消息**（必须）
5. 运行以下命令获取 Chat ID：

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['message']['chat']['id'])"
```

Token 和 Chat ID 将由 Agent 自动保存到 `~/.follow-builders/.env`。

---

## 修改设置

直接用自然语言告诉 Agent 即可，例如：

- "改成每周一早上推送"
- "语言换成中文"
- "摘要写得更简短一些"
- "显示我当前的设置"

---

## 自定义摘要风格

Skill 使用纯文本 Prompt 文件控制摘要方式，位于 `~/.claude/skills/follow-builders/prompts/`：

| 文件 | 作用 |
|------|------|
| `summarize-podcast.md` | 播客节目摘要方式 |
| `summarize-tweets.md` | X/Twitter 帖子摘要方式 |
| `summarize-blogs.md` | 博客文章摘要方式 |
| `digest-intro.md` | 整体摘要格式和语气 |
| `translate.md` | 英文内容翻译为中文的方式 |

可以直接编辑这些文件，也可以告诉 Agent 你的偏好，Agent 会自动更新。

---

## 默认信息源

### 播客
- Latent Space
- Training Data
- No Priors
- Unsupervised Learning
- Data Driven NYC

### X/Twitter 建造者（25 位）
Andrej Karpathy, Sam Altman, Swyx, Amanda Askell, Amjad Masad, Guillermo Rauch, Garry Tan, Alex Albert, Peter Yang, Dan Shipper 等

### 官方博客
- Anthropic Engineering
- Claude Blog

信息源由中心化服务统一维护，无需手动更新。

---

## 工作原理

```
中心化 Feed（每日更新）
        ↓
  Agent 拉取（1次HTTP请求）
        ↓
  Agent 根据偏好整理摘要
        ↓
  推送到 Telegram / 邮件 / 聊天窗口
```

所有内容集中抓取，用户端不需要任何 API Key。
配置、偏好和阅读记录均保存在本地 `~/.follow-builders/`。
