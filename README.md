# Openphtot AI Color

个人试用版 GPT 图像编辑调色 Web 应用：上传原图，输入调色提示词，后端调用 OpenAI 兼容 Images Edit API。

## 功能

- 上传 PNG / JPG / WEBP 原图
- 输入中文调色提示词
- 内置电影感、阳光闪耀、Smart HDR、Portra 胶片、卡片机预设
- 可选“画质提升到 8K”：GPT 调色完成后，服务端把结果最长边放大到 7680px 并锐化
- 服务端代理 API Key，不暴露到前端
- 支持自定义 OpenAI 兼容端点，例如 `https://bya.re/v1`

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

默认监听 `39006` 端口。

## 服务器配置

推荐把密钥放到服务器环境文件中，不要提交到 GitHub：

```bash
mkdir -p /etc/openphtot-ai-color
cat > /etc/openphtot-ai-color/openai.env <<'EOF'
OPENAI_BASE_URL=https://bya.re/v1
OPENAI_API_KEY=你的_API_Key
EOF
chmod 600 /etc/openphtot-ai-color/openai.env
systemctl restart openphtot-ai-color
```

## API

- `GET /api/status`：查看服务状态
- `POST /api/edit`：上传图片并调用图像编辑模型

`POST /api/edit` 表单字段：

- `image`：图片文件
- `prompt`：调色提示词
- `model`：默认 `gpt-image-2.5-sunburst`
- `quality`：默认 `auto`
- `size`：默认 `auto`

## 注意

当前版本是 MVP 试用版，没有登录、计费、历史记录和队列系统。公开部署时建议加访问密码或登录保护，避免 API Key 被他人消耗。
