# SkillsShark · 技能鲨

> 本地 AI 技能（Agent Skills）管理、翻译与打包桌面工具 —— 让中文用户**一眼看懂、一用就会**。

**当前版本：v0.2.1**（开发中）· Windows x64 NSIS 安装包

鲨 = 敏锐、精准、快。SkillsShark 把你散落在各个 AI 工具里的 skills 统一扫进来：
看懂它（流式翻译成中英对照）、管好它（分类 / 搜索 / 状态追踪）、分享它（打包成 `.skillpack` 在平台内流通）。

## ✨ 核心功能

| 模块 | 能力 |
|------|------|
| **多源扫描** | 配置多个 skills 目录（路径 / 标签 / 启用开关），按标签分组展示；源目录删除自动标记 |
| **流式翻译** | 调 LLM API 流式生成中英对照译文；大文件自动分块；哈希增量跳过未变化原文；自动派生中文标题 / 描述 |
| **浏览视图** | 首页分类卡 → 分类详情 → 详情抽屉三级导航；网格 / 列表双布局；合集嵌套折叠；`Ctrl+K` 全局搜索（中文名 / 原名 / 描述全字段命中） |
| **引用台账（Hub）** | 技能与各 AI 工具之间的链接 / 副本统一管理；出处→落点可视化 + 健康状态色条；转副本 / 重建 / 解除收进卡片菜单；多维筛选（类型 / 状态 / 落点工具，已选条件内联可移除）；建链对话框技能选择器为树结构懒展开 |
| **Skill Packs** | 勾选技能打包为 `.skillpack`；导入 / 导出 / 安装到技能库 / 删除 / 改名；包内附 `pack.json` + `README.md` + 译文 sidecar |
| **导入管线** | 本地 zip / Git URL 两种来源；安全解压预览；提交时拍平嵌套、同名自动改名 |
| **创作工作台** | 全页沉浸式技能创作：新建 / 编辑 skill，name 前置 + 「做什么 / 何时用」引导表单自动派生 description；Markdown 编辑 / 分栏 / 预览；附带资源文件树（新建 / 删除 / 查看）；技能改名（目录 + frontmatter 同步）；草稿自动保存三态恢复、`Ctrl+S` |
| **AI 创作** | 模型直出 SKILL.md 原文流式生成，右侧预览实时滚动跟随，可「应用到正文」；60s 无输入淡入引导；内容参考分组只读卡 |
| **统一 AI 层** | 翻译 / AI 创作 / 连接测试统一走设置页 LLM 配置；各模块 prompt 模板集中在 `src/lib/ai/prompts/` 一处管理，便于维护 |
| **布局** | 顶栏模式 ↔ 侧栏模式全局切换（设置 → 外观）；侧栏为全高侧栏 + 技能库目录树（工具 → 合集 → 技能），可折叠为窄图标栏 |
| **外观** | 暗 / 亮双主题 + 四色 accent 预设，即时切换并持久化 |
| **数据外部化** | 配置 / 译文 / Packs / 导入库统一存放在系统数据目录，重装不丢；旧目录自动迁移 |

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2（Rust） |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS v4 + shadcn/ui（Radix） |
| 图标 / 通知 | lucide-react / sonner |

## 🚀 快速开始

环境：Node 18+、Rust stable（含 Tauri [平台前置依赖](https://v2.tauri.app/start/prerequisites/)）。

```bash
cd frontend
npm install
npm run tauri:dev      # 桌面应用开发模式（前端 HMR + Rust 热重载）
```

纯前端预览（无后端，假数据）：

```bash
npm run dev
# 浏览器访问 http://localhost:5173/?mock=1
```

生产打包：

```bash
npm run tauri:build    # Windows .exe / macOS .dmg / Linux .AppImage
```

Rust 单元测试：

```bash
cd frontend/src-tauri
cargo test
```

## 📁 目录结构

```
skills-shark/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/            # shadcn/ui 基础组件
│   │   │   ├── layout/        # Topbar / StatBar / TabNav / Footer / BackgroundFX
│   │   │   ├── skill/         # HomeView / CategoryView / DetailSheet / SkillCard /
│   │   │   │                  # FolderCard / PackCard / PacksView / PackCreateDialog /
│   │   │   │                  # ImportDialog / UrlImportDialog / CommandSearch /
│   │   │   │                  # CreationView / AuthoringWorkbench（创作工作台）…
│   │   │   ├── settings/      # 设置（扫描路径 / LLM / 外观）
│   │   │   └── common/        # GhostCard / Tip / MarkdownRenderer / ConfirmDialog …
│   │   ├── hooks/             # useSkills（扫描 + 分组）、mockSkills（?mock=1）
│   │   ├── lib/               # api（invoke 封装）/ translate-api / authoring-api / bilingual /
│   │   │                      # markdown / llm-config / wb-draft / ai（统一 LLM 层 + prompts）
│   │   ├── assets/brand/      # 品牌资产生成管线（源图 → tile / favicon / 全套应用图标）
│   │   ├── App.tsx            # 主应用与全局状态
│   │   └── index.css          # 主题变量 + accent 预设
│   └── src-tauri/
│       ├── src/               # scanner / translations / pack / import / config / authoring 等（含单测）
│       ├── icons/             # 应用图标全尺寸
│       └── tauri.conf.json
├── skills/                    # 示例扫描数据
├── docs/                      # 阶段规划文档（PLAN-*.md）
├── AGENTS.md                  # 项目演进追踪
└── README.md
```

## 💾 数据目录

运行时数据与代码分离，位于系统数据目录（Windows：`%AppData%\Skills Shark`）：

```
Skills Shark/
├── config.json          # 扫描路径 / LLM 配置（仅存本地）
├── translations.json    # 译文索引
├── translations/        # 中英对照译文文件
├── packs/               # 已创建的 Skill Packs
└── imported/            # 由 zip / URL / Pack 安装进来的技能库
```

首次启动若发现旧版数据目录，自动迁移并自校验。

## 🧰 Skillpack 安装与使用

用户向指引：别人的 `.skillpack` 怎么用起来，自己的技能怎么打包分享。包的磁盘结构见下一节。

### 安装技能包

| 入口 | 步骤 | 实际行为 |
|------|------|----------|
| **本地文件导入** | Packs 页点「导入 .skillpack」虚线卡，或把 `.skillpack` / `.zip` 直接拖进应用窗口 | 自动探测压缩包内是否含 `pack.json`：是 Skill Pack → 展示包名 / 版本 / 技能数，点「导入到 Packs 库」；否则按普通 zip 技能库导入 |
| **分享链接 / Hub** | 当前版本**不支持**从 URL 直接安装 Pack | 需向分享者索取 `.skillpack` 文件后本地导入（URL 导入对话框中会明确提示）；从 git 仓库货架导入在 v0.2 规划中（PLAN-06 模块 A） |

导入时自动执行三道闸：

- **版本闸** —— 包的 `format_version` 高于当前应用版本时拒绝导入，提示先升级；
- **sha256 自验** —— 清单登记的每个文件逐一校验哈希，任一不符即整包拒收；
- **不覆盖** —— 与已有包 id 冲突时自动改名（如 `my-pack-2`），已有包不受影响。

导入完成只是进入 **Packs 库**（数据目录 `packs/`），技能尚未落地到技能库。

### 安装到技能库

在 Packs 页对目标包点「**安装**」：

1. 包内每个技能目录拷入数据目录 `imported/<包名>/`（库名已存在时自动追加 `-2`；重复安装同一包会产生多份独立副本）；
2. 写入 `.import.json` 记录来源（`pack:<id>`）与安装时间；
3. 应用自动跳转技能库，技能出现在「**导入**」分类下。

### 使用已安装的技能

- **浏览 / 翻译**：「导入」分类下点开技能详情抽屉，查看原文 / 译文，流式翻译生成中英对照（与其他来源的技能完全一致）；
- **引用到 AI 工具**：详情抽屉的「引用」按钮或 Hub 页「新建引用」——链接（junction，推荐）/ 复制 / 移动三选一，把技能放进 Claude Code、Codex CLI 等已注册工具的 skills 目录；引用记录在 Hub 页引用台账统一管理（解除 / 转副本 / 健康状态）。

### 管理与删除

- Packs 页支持卡片网格 / 列表双布局，展示版本、作者、技能数与已翻译数；
- 「**删除**」只移除 `packs/<id>` 的包本体：**不影响**已「安装」到技能库的副本（那是独立物理拷贝），也不影响已在 Hub 建立的引用。

### 创建与导出自己的技能包

1. Packs 页「**新建 Pack**」→ 填名称 / 版本（默认 `1.0.0`）/ 作者 → 从全部技能勾选（单次上限 40 个；源文件已失效的技能不可选）；
2. 应用把技能目录原样拷入 `packs/<id>/`（临时目录写入后原子落盘），生成 `pack.json` 元数据与 GitHub 可直接渲染的 `README.md`，译文状态随包记录；
3. 包卡片点「**导出**」→ 选择保存位置 → 得到可分享的 `.skillpack` 文件（超过 50MB 会提示体积）。

## 📦 .skillpack 包格式

平台内流通的聚合包，zip 容器，解包即生态原生布局：

```
xxx.skillpack (zip)
├── pack.json            # 包元数据：名称 / 版本 / 作者 / 技能清单 / 概述
├── README.md            # 包级说明（GitHub 可直接渲染）
├── i18n/                # 译文 sidecar（默认随包）
└── <skill 目录>/…       # 原生 SKILL.md 布局，任意 AI 工具可直接取用
```

## 🎨 品牌资产

`frontend/src/assets/brand/` 为品牌素材位，源图换稿后按 README 三步重跑即可全触点更新
（顶栏 / splash / favicon / 全套应用图标）。

## 📝 文档与追踪

- [`docs/`](./docs) — 各阶段规划与拍板记录
- [`AGENTS.md`](./AGENTS.md) — 项目演进追踪
- [`shark-web/`](../shark-web) — 官网与使用手册（v0.2.2 起独立为顶层项目，后续规划为个人站与作品合集）

## 📌 版本记录

### v0.2.1（2026-08-06）

布局重构 + Hub / Packs 体验打磨 + 官网落地。

- **全局布局切换（PLAN-10）**：顶栏模式 ↔ 侧栏模式（设置 → 外观切换）；侧栏为全高侧栏 + 技能库目录树（工具 → 合集 → 技能三级折叠），可折叠为 60px 图标栏；侧栏底部用户栏（头像 + ⋯ 菜单：刷新 / 主题 / 设置 / 关于）、面包屑全级可点跳转、树展开收起修复、搜索收敛为 `Ctrl+K`
- **Hub 引用台账重做**：出处→落点可视化面板 + 左缘健康色条（正常隐藏、异常才上色）；转副本 / 重建 / 解除收进卡片 ⋯ 菜单，异常才露「重建」主按钮；去掉按工具分块改全平铺；统一筛选入口（类型 / 状态 / 落点工具多维勾选 + 已选条件内联可点 × 移除 + 「显示 X / N 条」计数）；建链对话框技能选择器改为树结构懒展开 + 搜索
- **Packs**：包改名（前后端 `pack_rename`，同步 `pack.json` / `README.md`）；网格卡片 ⋯ 菜单（改名 / 删除）；空状态去重
- **体验修复（PLAN-09）**：配置后翻译不再误报未配 Key（DetailSheet 陈旧 `hasLLMKey`）、下拉悬停高亮、问号仅 hover 触发；Hub 反向链接源技能被吞修复（junction 落点不占代表位）；翻译 / AI 创作支持主动停止（AbortController）；下载 / 导入目录可配置
- **打包携带译文（P10b）**：`create_pack` 写入 `i18n/` 双语 sidecar，`install_pack` 按新 skill_id 恢复译文，导入方立即可看中文
- **空状态统一**：新增共享 `EmptyPanel` 组件，技能库 / 创作 / Hub / Packs / 分类钻取统一样式口径
- **官网与手册**：官网站点（自 v0.2.2 起独立为 `../shark-web/`，后续规划为个人站）重写——去 GitHub（仅 Gitee）、暗色苔绿品牌、使用手册嵌入 `manual.html`；移除详情面板与侧栏的 Codex / Claude「兼容」徽章（能用是基础能力，不是卖点）

### v0.2.0（2026-08-05）

作者即创作者——从「看别人的」到「做自己的」。

- **创作工作台（PLAN-07）**：全页沉浸式技能创作——新建 / 编辑 skill，name 前置 + 「做什么 / 何时用」引导表单自动派生 description；Markdown 编辑 / 分栏 / 预览；附带资源文件树（新建 / 删除 / 查看，SKILL.md 受保护）；技能改名（目录 + frontmatter 同步）；草稿自动保存三态恢复、`Ctrl+S`、返回守卫
- **AI 创作（W3 契约）**：模型直出 SKILL.md 原文流式生成、右侧预览实时滚动跟随、可「应用到正文」；60s 无输入淡入引导；内容参考分组只读卡
- **统一 AI 层**：新增 `src/lib/ai/`——翻译 / AI 创作 / 连接测试统一走设置页 LLM 配置；各模块 prompt 模板集中在 `prompts/` 一处管理
- **中文回显**：AI 创作 description 改为中文结构「做什么。当何时用时。」，回显「做什么 / 何时用」为中文
- **修复**：scanner 提取 emoji 按字节截断中文内容触发 `not a char boundary` panic → 改字符边界安全截断

### v0.1.0（2026-08-04）

首个公开版本。

- **发布形态**：Windows x64 NSIS 安装程序（用户自选安装目录；简体中文/English 安装界面；支持"仅为我安装/所有用户"；内嵌 WebView2 引导）
- **多源扫描 / 流式翻译 / Skill Packs（P1：打包、导入、安装、sha256 自验、版本闸）/ zip 与 Git URL 导入管线 / 数据目录外部化 / 双主题**
- 标识符定为 `com.skills-shark.desktop`（数据目录与标识符解耦，固定 `Roaming\Skills Shark`）
- 内置两个产品使用技能：`skills-shark-quickstart`（上手指南）、`skills-shark-packs`（打包流通），兼作翻译功能演示素材

## 🤝 贡献

本项目由 Paw（需求 / 方案 / 文档）与 Pal（架构 / 实现）协作开发。
仅供学习和个人使用。

---

*最后更新：2026-08-06*
