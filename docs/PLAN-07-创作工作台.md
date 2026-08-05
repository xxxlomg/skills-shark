# PLAN-07 创作工作台（Authoring Workbench）

> 状态：修订版（2026-08-05 Paw 完善）。boss 已拍板本轮范围：**只做常规 skills 规范，
> Codex / Claude 兼容改动暂放**（见 §0.5）。§9 疑点待 boss 拍板后即可开工。
> 来源：2026-08-05 UI 反馈第二轮（条目 1/2/3）+ 同日 Paw 完善讨论
> 参考：`C:\Users\ruanzh\.claude\skills\skill-creator\SKILL.md`（六步法）

---

## 0. 需求复述（boss 原话提炼）

1. 创作已经相当于一个**小工作台**；进入创作卡片应该是**完整页面**，而非弹窗。
2. AI 创作**不能直接模糊生成**：用户先描述"需要一个怎么样的 skill"，要有**交互模板**和**内容参考**。
3. Markdown 编辑器要**大、宽**（全页化后自然满足，过渡期已加宽 dialog）。
4. 新建入口单一化：只保留「新建」按钮（ghost 卡已删，本轮已落地）。
5. **（2026-08-05 新增，boss 拍板）Codex 兼容与 Claude 兼容改动暂放**：
   兼容具体怎么做尚未想清楚，本轮**只实现常规 skills 规范**
   （SKILL.md + frontmatter + 附带资源）。影响：
   - 工作台右侧 **不设 Codex 兼容 tab**；
   - 数据流**不含** `openai_yaml_generate` 调用；
   - 卡片菜单现有的「转 Codex 兼容 / 转 Claude 兼容」**原样保留、不改动**
     （已有功能不拆不改，兼容方向想清楚后另起计划）。

## 1. 信息架构

创作 tab 两个状态（CreationView 内部状态切换，不动 view-registry / TabNav）：

- **列表态**：现状卡片网格（ghost 卡已删；卡片菜单含改名 + 双兼容转换，本轮不动）。
- **工作台态**：点卡片 → 编辑已有；点「新建」→ 空草稿（name 未填）。

工作台占满内容区；顶栏左侧「← 返回创作列表」。

## 2. 布局

```
┌ 顶栏：← 返回 │ name（inline 编辑，hyphen-case 实时校验）│ 落点下拉（新建态）│ 未保存圆点 │ 校验徽章摘要
├ 左栏 38%（描述与规划）
│  A 引导式描述表单（交互模板，skill-creator Step 1/4 三问）
│    - 目的：做什么（一句话）
│    - 触发：何时用 / 用户会说什么（多行，一行一例）
│    - 步骤：主要工作流（多行 bullet）
│    - 附带资源勾选：scripts / references / assets
│      （勾选 → 首次落盘时生成目录骨架 + 示例占位文件）
│  B 写作准则（折叠卡）：description 是触发唯一依据 / 祈使句 /
│    渐进披露三级加载 / SKILL.md <5k 词 / 资源不 duplication
│  C 内容参考：下拉选一个已装真实技能，只读浏览其 SKILL.md（照例子学）
│    候选范围建议 = 全部扫描源（含 Claude/Cursor 的真实技能），见 §9④
│  D AI 规划按钮（需 LLM 配置）：组装 A+B 生成草稿 → 流式预览 →
│    「应用到正文」（只改内存草稿，不直接落盘）
│    60s 无输入淡入「没灵感？试试 AI 规划」（从 NewSkillDialog 迁移）
├ 右栏 62%（编辑）
│  tabs：正文 SKILL.md │ frontmatter │ 附带资源
│  （本轮不设 Codex 兼容 tab —— 兼容暂放，见 §0.5）
│  正文：大编辑器 + 编辑/分栏/预览（默认分栏，13-14px）
│  frontmatter：name / description 结构化字段（与左栏 A 双向同步，可手改；
│    建议不做裸 YAML 编辑，见 §9③）
│  附带资源：scripts/references/assets 文件树 + 新建/删除/查看
└ 底栏：校验矩阵 2×3（diagnostic）+ issue 列表折叠 + 保存（首存=创建，Ctrl+S 等效）
```

## 3. 数据流与状态

- 草稿（内存）：`{ name, purpose, triggers, steps, resources, body, fmDesc }` + dirty 标记。
- **Ctrl+S = 保存**（工作台必备快捷键，W1 落地）。
- **草稿兜底**：dirty 时将 draft 序列化写 localStorage（key 按 skill id / `new`），
  重新打开同一技能时提示恢复；防崩溃 / 误关丢失。
- **首存**：`skill_new`（authored）或 `skill_commit_draft`（工具落点）→ 切编辑态。
  资源勾选 → 首存后逐个 `skill_write_file` 写骨架占位。
- **后续保存**：body → `skill_write_file`；name/desc → `skill_edit_frontmatter` /
  `skill_rename`（name 变更走真重命名，见 §9②）。
- **返回保护**：dirty 时返回弹确认。
- 保存后 `refresh()`；工作台 skill 对象按 id 从新 skills 数组重取，避免 stale。

## 4. AI 规划 prompt 模板（去模糊化核心）

```
system: 你是技能架构师。输出完整 SKILL.md（---frontmatter--- + 正文）。
准则：description 第三人称、25-64 字符、写清做什么+何时用；
正文祈使句；按「目的/触发/步骤」组织；勾选的资源要在正文中引用其路径。
user: 目的：{purpose}
触发示例：{triggers}
步骤：{steps}
附带资源：{resources}
```

输入源 = 左栏结构化表单，**不接受自由主题一句话**（废 NewSkillDialog 的 topic 模式）。

**输出契约变更（相对现状 C7 链路）**：废弃 `authoring-api.ts` 现行的
```` ```json ```` 围栏 + `{name, description, body, references}` 契约，
改为模型直接输出**完整 SKILL.md 原文**。规则：

- 「应用到正文」时解析 frontmatter → 回填 draft 的 name/description，正文 → body；
- AI **不再生成 references 附件文件**（附件骨架改由左栏勾选生成，更可控）；
- 现有 `generateAndCommit` / `parseDraft` 直落盘链路退役（见 §6 退役清单）；
- 收益：无 JSON 转义地狱，流式预览内容即所见即所得。

## 5. 后端增量（2 个新命令）

- `skill_list_files(skill_dir)`：文件树（深度 ≤3，跳 .git/node_modules），
  路径归属闸复用 C6 `assert_path_owned_with_roots`。
- `skill_delete_file(skill_dir, rel)`：同闸；拒删 SKILL.md。
- 单测：各 2-3 个（逃逸拒 / SKILL.md 保护 / 树形状）。

其余全部复用现有命令（skill_new / skill_write_file / skill_edit_frontmatter /
skill_rename / skill_validate / callLLMStream）。
注：`openai_yaml_generate` 本轮**不再是工作台依赖**（仅卡片菜单旧入口在用，保留不动）。

## 6. 前端增量

- 新组件 `AuthoringWorkbench.tsx`（估 550-650 行）：顶栏/左栏/右栏/底栏四块。
- `CreationView`：卡片 onClick → `setWorkbench({skill})`；新建 → `setWorkbench(null)`。
- **退役**：
  - `CreationEditDialog`、`NewSkillDialog`（整体删除）；
  - `authoring-api.ts` 的 `generateAndCommit` / `parseDraft`（C7 直落盘链路）；
    `buildAuthoringPrompt` 按 §4 新契约重写，`callLLMStream` / LLM 配置读取复用。
- HomeView「新建技能」按钮 → 切创作 tab + 进空工作台（App 层传 navigate 信号；
  实现建议：App 持一个递增的 `openNewSignal` 计数 prop，避免抬升工作台状态）。
- 卡片菜单（改名 / 转 Codex / 转 Claude）**保留现状**，不进工作台。
- mock：workbench 全通道可验（mock 技能可编辑/可参考）。

## 7. 任务拆分（估 4 人天）

| # | 任务 | 人天 |
|---|------|------|
| W1 | 工作台骨架 + 列表/工作台切换 + 返回保护 + name inline 校验 + Ctrl+S + 草稿 localStorage 兜底 | 1.0 |
| W2 | 引导表单 + 写作准则卡 + 内容参考浏览 | 0.5 |
| W3 | AI 规划流式 + 应用到正文（含 frontmatter 解析回填）+ 60s 淡入迁移 | 0.5 |
| W4 | 后端 2 命令 + 附带资源文件树 tab | 1.0 |
| W5 | 底栏校验矩阵接入 + frontmatter 结构化同步 | 0.5 |
| W6 | mock 验收 + 真机走查 + 文档状态更新 | 0.5 |

顺序 W1→W2→W4→W3→W5→W6（地基先于 AI）。
注：砍掉 Codex tab 省下的工作量，约与 Ctrl+S / 草稿兜底 / frontmatter 回填新增持平。

## 8. 风险与坑

1. **stale skill**：保存后 skills 数组刷新，工作台必须按 id 重取，否则徽章/路径 stale。
2. **name 变更**：编辑态改 name 必须走 `skill_rename`（目录同步），不能只改 frontmatter（CL-01）；
   编辑态顶栏 name 是否允许直接改，见 §9②。
3. **首存失败回滚**：资源骨架写一半失败 → 保留已写文件，toast 明示，不静默。
4. **LLM 未配置**：AI 规划钮 disable + Tip 引导去设置页，不报错。
5. **内容参考**只读浏览，禁止误触编辑（独立只读渲染通道）。
6. 工作台不注册 view-registry → TabNav 零改动；但浏览器后退键不感知内部状态，
   返回保护只覆盖「← 返回」按钮与 tab 切换（dirty 时切 tab 也弹确认）。
7. **窄窗口挤压**：左栏 38% 在小窗口下偏挤；本轮做 min-width 保护，
   可拖拽分割线 / 左栏折叠记入缓办（§10）。

## 9. 疑点待拍板（Paw 2026-08-05 完善时提出）

> 每项附 Paw 建议；boss 勾选后本节转为决定，写回正文相应章节。

1. **AI 输出契约**：改为直接输出 SKILL.md 原文（§4），退役现行 JSON 围栏契约；
   AI 不再顺带生成 references 附件（附件由左栏勾选生成）。
   → 建议：接受。需 boss 确认放弃「AI 一次生成附件文件」能力。
2. **编辑态 name**：顶栏直接可改（保存时静默走 `skill_rename` 重命名目录），
   还是只读 + 显式「重命名」入口？目录被静默改名可能波及外部引用。
   → 建议：编辑态只读，改名走显式入口 + 提示「将同步重命名目录」。
3. **frontmatter tab 形态**：结构化字段（name/description 两个输入框，与左栏共享 draft state）
   vs 裸 YAML 文本编辑（需来回 parse，易脏）。
   → 建议：本轮结构化字段；裸 YAML 留作进阶模式（§10）。
4. **内容参考候选范围**：仅 authored 创作技能 vs 全部扫描源技能
   （含 Claude/Cursor 目录里的真实技能——照例子学，例子越多越好）。
   → 建议：全部扫描源，只读通道不增加风险。
5. **兼容方向（暂放项备忘，不急）**：Codex/Claude 兼容最终形态——继续一键转换？
   双向同步？还是按工具配置 profile？boss 想清楚后另起 PLAN-08 或重启本计划兼容章节。

## 10. 缓办清单（记录在案，本轮不做）

- 左栏可拖拽分割线 / 折叠
- frontmatter 裸 YAML 编辑模式（进阶）
- Codex / Claude 兼容的工作台整合（待 §9⑤ 方向定案）
- 浏览器后退键感知工作台内部状态（如未来引入路由层）
