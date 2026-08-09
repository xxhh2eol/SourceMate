# SourceMate

SourceMate 是一款将 GitHub 收藏（Star）变成个人知识库的桌面应用。它可以批量导入你 Star 过的项目，自动同步仓库信息和 README，并借助 AI 对项目打标签、生成中文摘要和版本说明，帮助你管理、检索和理解收藏的项目。

## 主要功能

- **项目收藏管理**：粘贴 GitHub 链接即可自动识别并入库，也支持按 GitHub 账号批量导入 Star；卡片/表格双视图，支持搜索、标签筛选和排序，一键检查项目更新
- **README 知识库**：同步并缓存多语言 README，支持 Markdown 渲染与代码高亮；只有英文 README 时会由 AI 翻译成中文
- **AI 标签体系**：按类型、技术栈、用途、领域等 8 个维度自动打标签，AI 建议的候选标签可人工审核、合并或升级
- **版本发布记录**：自动记录项目的 GitHub Release，包含附件信息和 SHA-256，并由 AI 生成中文发布说明
- **个人笔记**：每个项目可以保存自己的笔记，方便记录使用心得
- **AI 用量统计**：按模型和功能维度统计 token 消耗与调用耗时
- **多 GitHub 账号**：支持管理多个 Token，自动检测有效、过期、无效和权限不足状态

## 设置

- **通用**：界面语言（中文 / English）、明暗主题（可跟随系统）、主题色、界面字体、AI 任务并发数
- **AI 模型**：管理多个模型配置（支持 OpenAI、DeepSeek、Ollama 等 OpenAI 兼容接口），可设置默认模型、启用/停用、测试连接；API Key 加密存储，不会明文显示
- **GitHub 账号**：添加/编辑/删除多个 GitHub Token，查看账号状态和上次验证时间，并勾选账号批量导入 Star 项目
- **网络**：配置 HTTP 或 SOCKS5 代理，用于访问 GitHub 和 AI 接口
- **数据**：数据库备份与恢复
- **使用统计**：查看 AI 调用的模型、功能、token 消耗和失败记录

## 开发

环境要求：Node.js 22 及以上（推荐 24）。

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run typecheck   # 类型检查
npm run lint        # 代码检查
npm run build       # 构建
npm run dist        # 构建 Windows 安装包
npm run db:generate # 数据库结构变更后生成迁移
```

## 技术栈

Electron · React 19 · TypeScript · Ant Design · SQLite（node:sqlite）· Drizzle ORM · electron-vite

## License

MIT
