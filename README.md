# Openphoto AI Color

Openphoto AI Color 是一个面向摄影后期的 GPT 图像编辑与调色 Web 应用：上传照片，输入自然语言要求，即可批量生成更统一的色彩和影像氛围。

适合摄影师、内容创作者和需要快速处理一组照片的人使用。项目提供简洁的浏览器工作台、服务端任务代理和参考图风格分析，不要求用户把 API Key 暴露在浏览器端。

## 核心能力

- 批量处理最多 10 张照片，逐张查看、下载和重新处理
- 支持 PNG、JPG、WEBP，以及拖入照片或文件夹上传
- 使用自然语言描述色彩、光影、胶片感、柔焦、动感和颗粒等效果
- 通过参考图工作台提取影像特征，再应用到原图像素
- 提供可选的 AI 细节增强和 8K 输出；明确区分插值放大与真实细节恢复
- 浏览器 IndexedDB 保存当前批次，刷新页面后可以恢复任务状态
- 服务端代理 AI 请求，API Key 不下发到前端

## 功能

- 无需访问密码
- PNG / JPG / WEBP 多图上传
- 每张原图与对应结果独立成卡
- 全局提示词批量处理，单图可改提示词后重新处理
- IndexedDB 保存当前批次，刷新后恢复原图、结果和任务轮询
- 服务端代理 API Key，仅执行 AI 摄影调色
- 独立 `/reference.html` 参考氛围工作台：AI 用两轮图像编辑读取参考图的光影、色彩、柔焦、动感、颗粒和光晕，再从原图像素制作结果；支持风格强度和刷新恢复

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

默认监听 `39006` 端口。访问 `/` 进入欢迎页，点击“开始”进入 `/studio.html`。
在原工作台点击“参考图调色”进入独立页面；该页面的原图、参考图和结果保存在独立的浏览器 IndexedDB，不会清除多图工作台的数据。

## 服务器配置

```bash
mkdir -p /etc/openphoto-ai-color
cat > /etc/openphoto-ai-color/openai.env <<'EOF'
OPENAI_BASE_URL=https://bya.re/v1
OPENAI_API_KEY=你的_API_Key
EOF
chmod 600 /etc/openphoto-ai-color/openai.env
systemctl restart openphoto-ai-color
```

## API

- `GET /api/status`：服务状态
- `POST /api/batch`：提交批量或单图任务
- `GET /api/batch/:id`：查询任务状态与结果
- `POST /api/reference`：提交单张原图及参考图；沿用 `GET /api/batch/:id` 查询任务

`POST /api/reference` 使用 multipart 字段 `source`、`reference`（各一张 PNG/JPG/WEBP，最大 20 MB）、`jobId`、`imageId`（UUID）、`strength`（0–100，默认 70）。相同 `jobId` 不重复处理。两轮 AI 分别生成风格样张与原图氛围候选，服务端只提取其摄影特征，不直接采用候选画面的场景像素；任务查询增加阶段 `stage`，结果包含影像特征 `styleSignals`。0% 不调用风格分析且输出原图。

`POST /api/batch` 使用 multipart 字段：

- `images`：最多 10 张图片
- `jobId`：可选 UUID；重复提交同一 ID 会返回原任务
- `imageIds`：与图片顺序对应的唯一 UUID JSON 数组
- `prompt`、`model`、`quality`、`size`

任务保存在服务进程内存中并在完成 30 分钟后清理。浏览器刷新可以恢复；服务器重启后任务会失效。
