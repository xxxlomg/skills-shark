# PLAN-05 — Skills Pack 打包与平台内流通

> 状态：P1 已完成（2026-08-03）· P2/P3 待启动
> 前置：PLAN-04（数据目录外部化 / 导入管线）

## 0. 产品定位（格式设计的总约束）

本产品 = skills 管理 + 翻译，帮助用户理解 skills 内容。
**Pack 流通建立在平台之上**：打包双方都是 SkillsShark 用户，流通才有意义。
因此 `.skillpack` 是**平台原生格式**，不追求适配 Claude/Codex 等外部工具的导入约定。

唯一保留的生态逃生舱（零成本）：`skills/**` 内每个 skill 文件夹**原样保留 SKILL.md 与资源相对路径**——任何人手动解包仍可逐文件夹取用。包级文件（pack.json/README/i18n）对外部工具是无害附加层。

## 1. 格式规范（.skillpack = zip）

```
my-pack.skillpack
├─ pack.json          # 机器层（唯一事实源）
├─ README.md          # 人类层：AI 概述 + 目录 + 逐 skill 作用（Pack 详情页渲染）
├─ i18n/zh/<name>.json# 可选翻译 sidecar
└─ skills/<name>/…    # 原样 skill 文件夹（SKILL.md + 资源）
```

**根目录禁止 SKILL.md**（避免我们自己的扫描器把合集根误判为 skill）。

### pack.json schema v1

```json
{
  "format_version": 1,
  "id": "opencode-essentials",
  "name": "OpenCode Essentials",
  "ver": "1.0.0",
  "author": "ruanzh",
  "created_at": "2026-08-03T08:00:00Z",
  "generator": "SkillsShark 0.1.0",
  "summary": {
    "source": "ai | static",
    "overview": "合集概述…",
    "skills": { "skills/browser-cdp": "一句话作用" }
  },
  "i18n": ["zh"],
  "skills": [
    {
      "path": "skills/browser-cdp",
      "name": "browser-cdp",
      "has_translation": true,
      "bytes": 12345,
      "files": [{ "rel": "SKILL.md", "sha256": "…" }]
    }
  ]
}
```

- `files[]` 全量清单 + sha256：解包后自验完整性（规模小，全录不亏）。
- `summary.source` 标记 AI/静态降级，导入侧据此显示"重新生成总结"入口。

### i18n sidecar

`i18n/zh/<skill-name>.json` = `{ "description_zh": "…", "translation_md": "全文译文或空" }`。
**翻译随包流通是平台差异化价值**——接收方拿到的不止原文。

## 2. 打包流程

1. 技能库进入多选模式 → 勾选 N 个 skill → 「打包」。
2. 对话框：name / ver / author / [x] 携带中文翻译 / [生成 AI 总结]。
3. AI 总结复用现有翻译 API 的 LLM 配置：
   - 输入预算：每 skill name + description 截断 300 字 + description_zh（若有），上限 40 skill；
   - 输出 **JSON**（overview + 逐 skill 一句话），前端模板渲染 README.md——不让 LLM 直写 markdown；
   - 失败/未配置 → 静态目录版（name + description 截断）+ `source:"static"`。
4. 写入 canonical：`AppData/packs/<id>/`（先 temp 后 rename，防半写）。
5. 导出 = 另存对话框，**默认目录 packs/，用户可改**；导出副本与 canonical 不互绑。

## 3. 导入 / 安装

- 有 `pack.json` → pack 导入：
  - `format_version` 高于本程序支持 → 明确报错"由更新版本生成，请升级"，不静默错 parse；
  - sha256 自验 → 登记 Packs 库，存 `packs/<id>/`；
  - **只进 Packs tab，不进扫描库**（pack = 分发单位）。
- 无 `pack.json` → 走 PLAN-04 旧拍平管线（行为不变）。
- 「安装」动作 = 把 `skills/*` 逐目录拷入 imported 库，复用同名改名逻辑 → 进入扫描（imported = 落地单位）。
- zip 防御：entry 数 / 总大小 / 深度封顶。

## 4. UI 触点

- Packs tab 接真实数据（PackCard 字段 ← pack.json）。
- Pack 详情：README 渲染 + 技能清单 + 翻译标记 + 动作（安装 / 导出 / 删除 / 重新生成总结）。
- 技能库网格多选模式（勾选条 + 底部动作栏）。

## 5. 后端命令（tauri）

`packs_list / pack_create / pack_export / pack_import / pack_install / pack_delete / pack_summary_gen`
存储根：`Roaming\Skills Shark\packs\`（数据目录与 identifier 解耦，P1 落地）。

## 6. 阶段拆分

- **P1** ✅：格式 + 后端命令 + 打包对话框（静态总结）+ 导入/安装最小闭环。
  - 落地记录：pack.rs（create/list/export/import/install/delete + sha256 自验
    + 版本闸），测试 10/10 通过；前端 PackCreateDialog、PackCard 实数据、
    ImportDialog pack.json 分流、导出另存/删除确认。
  - 附带修复：数据目录与 identifier 解耦（固定 `Roaming\Skills Shark`，
    config.rs DATA_DIR_NAME）；「导入」扫描路径归一化自愈（迁移残留）。
- **P2**：AI 总结生成 / 重新生成 + i18n sidecar 打包与导入回填。
- **P3**：Pack 详情页（README 渲染 + 清单）。
- 二期再议：GitHub 一键发布按钮（D8）。

## 7. 拍板记录

| # | 决策 | 结论 |
|---|---|---|
| D1′ | 包级说明 = README.md + pack.json，根无 SKILL.md | ✅ |
| D2 | i18n zh sidecar 可选、默认开 | ✅ |
| D3 | 导入只进 Packs tab，「安装」才落 imported | ✅ |
| D4 | AI 不可用降级静态目录 + 事后重生成 | ✅ |
| D5 | 存储 AppData/packs/<id>/ | ✅ |
| D7 | 导出位置用户自选，默认 packs | ✅ |
| D8 | GitHub 发布按钮二期 | ✅ |
| D9 | 平台原生格式，不适配外部工具；skills/** 原样保留作逃生舱 | ✅ |

## 8. 风险备忘

- ~~identifier 改 SkillsShark 系后 AppData 路径变~~ → P1 已解：数据目录固定
  `Roaming\Skills Shark`（与 identifier 解耦），「导入」扫描路径归一化自愈；
  旧 `com.skillsmanager.app` 目录降级为纯备份，可手工删。
- AI 非确定性问题靠"打包时冻结进 manifest"消解，导入侧零 AI 调用。
- 翻译全文入包可能放大体积，zip 压缩可接受；超 50MB 提示。
