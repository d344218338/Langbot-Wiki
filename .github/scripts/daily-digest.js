/**
 * 每日AI简报 - GitHub Actions 全自动发布脚本
 *
 * 流程:
 *  1. 从 follow-builders 拉取最新 AI 动态 (推文 + 播客 + 博客)
 *  2. 用 Claude API 整理成中文简报
 *  3. 用 Playwright 生成 16:9 封面图
 *  4. 调用微信公众号 API 上传封面 + 保存草稿
 *
 * 需要的 GitHub Secrets:
 *  WECHAT_APP_ID      - 微信公众号 AppID
 *  WECHAT_APP_SECRET  - 微信公众号 AppSecret
 *  ANTHROPIC_API_KEY  - (可选) 有了才有 AI 润色
 */

'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const { FormData } = require('formdata-node');
const { fileFromPath } = require('formdata-node/file-from-path');

// ─── 环境变量 ─────────────────────────────────────────────────────────────────
const WECHAT_APP_ID     = process.env.WECHAT_APP_ID;
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
  console.error('❌ 缺少 WECHAT_APP_ID 或 WECHAT_APP_SECRET');
  process.exit(1);
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────
const FEED_X_URL       = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const FEED_PODS_URL    = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json';
const FEED_BLOGS_URL   = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json';
const COVER_PATH       = '/tmp/cover.png';
const WX_TOKEN_URL     = 'https://api.weixin.qq.com/cgi-bin/token';
const WX_UPLOAD_URL    = 'https://api.weixin.qq.com/cgi-bin/material/add_material';
const WX_DRAFT_URL     = 'https://api.weixin.qq.com/cgi-bin/draft/add';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} 获取 ${url}`);
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} POST ${url}`);
  return res.json();
}

// ─── STEP 1: 拉取 feed ───────────────────────────────────────────────────────
async function fetchFeeds() {
  log('拉取 follow-builders feed...');
  const [xFeed, podFeed, blogFeed] = await Promise.all([
    fetchJSON(FEED_X_URL).catch(() => ({ x: [] })),
    fetchJSON(FEED_PODS_URL).catch(() => ({ podcasts: [] })),
    fetchJSON(FEED_BLOGS_URL).catch(() => ({ blogs: [] })),
  ]);

  const builders = xFeed.x || [];
  const podcasts  = podFeed.podcasts || [];
  const blogs     = blogFeed.blogs || [];

  log(`获取到: ${builders.length} 位 builder, ${podcasts.length} 播客, ${blogs.length} 博客`);
  return { builders, podcasts, blogs };
}

// ─── STEP 2: 生成文章内容 ────────────────────────────────────────────────────
function buildRawSummary({ builders, podcasts, blogs }) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;

  let parts = [];

  // X/Twitter 部分
  if (builders.length > 0) {
    parts.push('## 🔥 AI 建造者动态\n');
    for (const b of builders.slice(0, 12)) {
      if (!b.tweets || b.tweets.length === 0) continue;
      const tweets = b.tweets.slice(0, 2);
      parts.push(`**${b.name}**`);
      for (const t of tweets) {
        const text = t.text.slice(0, 280);
        parts.push(`${text}${t.url ? `\n${t.url}` : ''}`);
      }
      parts.push('');
    }
  }

  // 播客部分
  const recentPods = podcasts.filter(p => p.episodes && p.episodes.length > 0);
  if (recentPods.length > 0) {
    parts.push('## 🎙️ 最新播客\n');
    for (const pod of recentPods.slice(0, 3)) {
      const ep = pod.episodes[0];
      parts.push(`**${pod.name}** · ${ep.title}`);
      if (ep.description) parts.push(ep.description.slice(0, 200));
      if (ep.url) parts.push(ep.url);
      parts.push('');
    }
  }

  // 博客部分
  if (blogs.length > 0) {
    parts.push('## 📝 官方博客\n');
    for (const blog of blogs.slice(0, 3)) {
      if (!blog.articles || blog.articles.length === 0) continue;
      const art = blog.articles[0];
      parts.push(`**${blog.name}** · ${art.title}`);
      if (art.summary) parts.push(art.summary.slice(0, 200));
      if (art.url) parts.push(art.url);
      parts.push('');
    }
  }

  return { dateStr, rawText: parts.join('\n') };
}

async function generateContent({ builders, podcasts, blogs }) {
  const { dateStr, rawText } = buildRawSummary({ builders, podcasts, blogs });
  const title = `每日AI简报 | ${dateStr}`;

  // 如果有 Claude API key，用 AI 润色成中文简报
  if (ANTHROPIC_API_KEY) {
    log('调用 Claude API 生成中文简报...');
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: `你是一个微信公众号编辑，专门整理每日AI简报。

请把以下原始 AI 动态整理成一篇适合微信公众号的中文文章，要求：
- 文章标题固定为：${title}
- 正文用中文，语言简洁有力
- 每条内容要有小标题，保留原始链接
- 格式：## 标题 / 正文段落 / 链接
- 总字数 800-1500 字

原始内容：
${rawText}`,
          }],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const aiText = data.content?.[0]?.text || '';
        if (aiText.length > 200) {
          log(`AI 生成内容: ${aiText.length} 字符`);
          return { title, content: markdownToWxHtml(aiText), dateStr };
        }
      }
    } catch (e) {
      log(`Claude API 调用失败: ${e.message}，使用原始格式`);
    }
  }

  // 无 AI：直接格式化原始数据
  log('使用原始数据格式化...');
  return { title, content: markdownToWxHtml(rawText), dateStr };
}

// ─── Markdown → 微信公众号 HTML ───────────────────────────────────────────────
function markdownToWxHtml(md) {
  const style = {
    h2: 'font-size:18px;font-weight:bold;color:#1a1a1a;margin:24px 0 10px;padding:6px 0 6px 12px;border-left:4px solid #6366f1;background:#f8f7ff;',
    h3: 'font-size:15px;font-weight:bold;color:#333;margin:16px 0 6px;',
    p:  'font-size:15px;line-height:1.85;color:#444;margin:8px 0;',
    a:  'color:#6366f1;text-decoration:none;word-break:break-all;',
    strong: '',
    hr: 'border:none;border-top:1px solid #e5e7eb;margin:20px 0;',
    li: 'margin:5px 0;color:#444;line-height:1.75;',
  };

  // 先处理链接（避免被段落吞掉）
  const urlRegex = /https?:\/\/[^\s)>]+/g;

  let html = md
    .replace(/^## (.+)$/gm,   `<h2 style="${style.h2}">$1</h2>`)
    .replace(/^### (.+)$/gm,  `<h3 style="${style.h3}">$1</h3>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•*] (.+)$/gm, `<li style="${style.li}">$1</li>`)
    .replace(/^---+$/gm, `<hr style="${style.hr}">`)
    .split(/\n{2,}/)
    .map(para => {
      para = para.trim();
      if (!para) return '';
      if (/^<(h[23]|hr)/.test(para)) return para;
      if (para.includes('<li')) return `<ul style="padding-left:20px;margin:8px 0;">${para}</ul>`;
      // 把 URL 变成链接
      para = para.replace(urlRegex, url =>
        `<a href="${url}" style="${style.a}">${url}</a>`
      );
      return `<p style="${style.p}">${para}</p>`;
    })
    .join('\n');

  return `<section style="max-width:720px;margin:0 auto;padding:20px;">${html}</section>`;
}

// ─── STEP 3: 生成封面图 ───────────────────────────────────────────────────────
async function generateCover(title, dateStr) {
  log('启动 Playwright 生成封面图...');
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1280px;height:720px;
  background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%);
  display:flex;flex-direction:column;justify-content:center;align-items:center;
  font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
  color:#fff;overflow:hidden;position:relative;}
.grid{position:absolute;inset:0;
  background-image:
    linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);
  background-size:64px 64px;}
.glow{position:absolute;width:800px;height:800px;
  background:radial-gradient(circle,rgba(99,102,241,.3) 0%,transparent 65%);
  top:50%;left:50%;transform:translate(-50%,-50%);}
.content{position:relative;z-index:10;text-align:center;padding:60px 80px;}
.badge{display:inline-block;background:rgba(99,102,241,.75);
  border:1px solid rgba(165,180,252,.4);border-radius:20px;
  padding:7px 24px;font-size:13px;letter-spacing:3px;
  margin-bottom:32px;color:#c7d2fe;}
.title{font-size:60px;font-weight:900;line-height:1.2;
  background:linear-gradient(135deg,#fff 0%,#a5b4fc 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  margin-bottom:28px;}
.date{font-size:20px;color:rgba(199,210,254,.75);letter-spacing:2px;}
.corner{position:absolute;top:32px;left:52px;z-index:10;
  font-size:12px;color:rgba(165,180,252,.4);letter-spacing:3px;}
.dots{position:absolute;bottom:36px;right:52px;
  display:flex;gap:8px;z-index:10;}
.dot{width:8px;height:8px;border-radius:50%;background:rgba(165,180,252,.3);}
.dot.on{background:rgba(165,180,252,.9);}
.line{position:absolute;bottom:0;left:0;right:0;height:3px;
  background:linear-gradient(90deg,transparent,#6366f1,#a5b4fc,transparent);}
</style></head><body>
<div class="grid"></div><div class="glow"></div>
<div class="content">
  <div class="badge">AI DAILY DIGEST · 每日简报</div>
  <div class="title">每日 AI 简报</div>
  <div class="date">${dateStr}</div>
</div>
<div class="corner">FOLLOW BUILDERS · NOT INFLUENCERS</div>
<div class="dots">
  <div class="dot on"></div><div class="dot"></div><div class="dot"></div>
</div>
<div class="line"></div>
</body></html>`;

  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: COVER_PATH, fullPage: false });
  await browser.close();
  log(`封面图已生成: ${COVER_PATH} (${fs.statSync(COVER_PATH).size} bytes)`);
}

// ─── STEP 4: 微信公众号 API ───────────────────────────────────────────────────

async function getWxToken() {
  log('获取微信 access_token...');
  const url = `${WX_TOKEN_URL}?grant_type=client_credential&appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}`;
  const data = await fetchJSON(url);
  if (!data.access_token) {
    throw new Error(`获取 access_token 失败: ${JSON.stringify(data)}`);
  }
  log('access_token 获取成功');
  return data.access_token;
}

async function uploadCoverImage(token, imagePath) {
  log('上传封面图到微信...');
  const url = `${WX_UPLOAD_URL}?access_token=${token}&type=image`;

  const form = new FormData();
  form.set('media', await fileFromPath(imagePath, 'cover.png', { type: 'image/png' }));

  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json();

  if (!data.media_id) {
    throw new Error(`上传封面图失败: ${JSON.stringify(data)}`);
  }
  log(`封面图已上传，media_id: ${data.media_id}`);
  return data.media_id;
}

async function saveDraft(token, { title, content, thumbMediaId }) {
  log('保存草稿...');
  const url = `${WX_DRAFT_URL}?access_token=${token}`;

  const body = {
    articles: [{
      title,
      author:             'AI 简报',
      digest:             `${title} - 每日 AI 建造者动态汇总`,
      content,
      content_source_url: '',
      thumb_media_id:     thumbMediaId,
      need_open_comment:  1,
      only_fans_can_comment: 0,
    }],
  };

  const data = await postJSON(url, body);
  if (!data.media_id) {
    throw new Error(`保存草稿失败: ${JSON.stringify(data)}`);
  }
  log(`草稿保存成功！media_id: ${data.media_id}`);
  return data.media_id;
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date().toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: 'long', day: 'numeric'
  });

  log('══════════════════════════════════════');
  log(`每日AI简报自动发布 - ${today}`);
  log('══════════════════════════════════════');

  // 1. 拉取 feed
  const feeds = await fetchFeeds();

  // 2. 生成内容
  const { title, content, dateStr } = await generateContent(feeds);
  log(`文章标题: ${title}`);

  // 3. 生成封面图
  await generateCover(title, dateStr || today);

  // 4. 微信 API
  const token     = await getWxToken();
  const mediaId   = await uploadCoverImage(token, COVER_PATH);
  const draftId   = await saveDraft(token, { title, content, thumbMediaId: mediaId });

  log('══════════════════════════════════════');
  log('✅ 完成！草稿已保存到公众号草稿箱');
  log(`   草稿 ID: ${draftId}`);
  log('══════════════════════════════════════');
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
