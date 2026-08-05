# PLAN-07 创作工作台（Authoring Workbench）

> 状态：草案，待 boss 确认开工
> 来源：2026-08-05 UI 反馈第二轮（条目 1/2/3）
> 参考：`C:\Users\ruanzh\.claude\skills\skill-creator\SKILL.md`（六步法）

---

## 0. 需求复述（boss 原话提炼）

1. 创作已经相当于一个**小工作台**；进入创作卡片应该是**完整页面**，而非弹窗。
2. AI 创作**不能直接模糊生成**：用户先描述"需要一个怎么样的 skill"，要有**交互模板**和**内容参考**。
3. Markdown 编辑器要**大、宽**（全页化后自然满足，过渡期已加宽 dialog）。
4. 新建入口单一化：只保留「新建」按钮（ghost 卡已删，本轮已落地）。

## 1. 信息架构

创作 tab 两个状态（CreationView 内部状态切换，不动 view-registry / TabNav）：

- **列表态**：现状卡片网格（ghost 卡已删）。
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
│  D AI 规划按钮（需 LLM 配置）：组装 A+B 生成草稿 → 流式预览 →
│    「应用到正文」（只改内存草稿，不直接落盘）
│    60s 无输入淡入「没灵感？试试 AI 规划」（从 NewSkillDialog 迁移）
├ 右栏 62%（编辑）
│  tabs：正文 SKILL.md │ frontmatter │ Codex 兼容 │ 附带资源
│  正文：大编辑器 + 编辑/分栏/预览（默认分栏，13-14px）
│  frontmatter：name / description（与左栏 A 双向同步，可手改）
│  Codex：一键转换（现状保留）
│  附带资源：scripts/references/assets 文件树 + 新建/删除/查看
└ 底栏：校验矩阵 2×3（diagnostic）+ issue 列表折叠 + 保存（首存=创建）
```

## 3. 数据流与状态

- 草稿（内存）：`{ name, purpose, triggers, steps, resources, body, fmDesc }` + dirty 标记。
- **首存**：`skill_new`（authored）或 `skill_commit_draft`（工具落点）→ 切编辑态。
  资源勾选 → 首存后逐个 `skill_write_file` 写骨架占位。
- **后续保存**：body → `skill_write_file`；name/desc → `skill_edit_frontmatter` /
  `skill_rename`（name 变更走真重命名）；Codex → `openai_yaml_generate`。
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

## 5. 后端增量（2 个新命令）

- `skill_list_files(skill_dir)`：文件树（深度 ≤3，跳 .git/node_modules），
  路径归属闸复用 C6 `assert_path_owned_with_roots`。
- `skill_delete_file(skill_dir, rel)`：同闸；拒删 SKILL.md。
- 单测：各 2-3 个（逃逸拒 / SKILL.md 保护 / 树形状）。

其余全部复用现有命令（skill_new / skill_write_file / skill_edit_frontmatter /
skill_rename / openai_yaml_generate / skill_validate / callLLMStream）。

## 6. 前端增量

- 新组件 `AuthoringWorkbench.tsx`（估 550-650 行）：顶栏/左栏/右栏/底栏四块。
- `CreationView`：卡片 onClick → `setWorkbench({skill})`；新建 → `setWorkbench(null)`。
- **退役**：`CreationEditDialog`、`NewSkillDialog`。
- HomeView「新建技能」按钮 → 切创作 tab + 进空工作台（App 层传 navigate 信号）。
- mock：workbench 全通道可验（mock 技能可编辑/可参考）。

## 7. 任务拆分（估 4 人天）

| # | 任务 | 人天 |
|---|------|------|
| W1 | 工作台骨架 + 列表/工作台切换 + 返回保护 + name inline 校验 | 1.0 |
| W2 | 引导表单 + 写作准则卡 + 内容参考浏览 | 0.5 |
| W3 | AI 规划流式 + 应用到正文 + 60s 淡入迁移 | 0.5 |
| W4 | 后端 2 命令 + 附带资源文件树 tab | 1.0 |
| W5 | 底栏校验矩阵接入 + Codex tab 迁移 + frontmatter 同步 | 0.5 |
| W6 | mock 验收 + 真机走查 + 文档状态更新 | 0.5 |

顺序 W1→W2→W4→W3→W5→W6（地基先于 AI）。

## 8. 风险与坑

1. **stale skill**：保存后 skills 数组刷新，工作台必须按 id 重取，否则徽章/路径 stale。
2. **name 变更**：编辑态改 name 必须走 `skill_rename`（目录同步），不能只改 frontmatter（CL-01）。
3. **首存失败回滚**：资源骨架写一半失败 → 保留已写文件，toast 明示，不静默。
4. **LLM 未配置**：AI 规划钮 disable + Tip 引导去设置页，不报错。
5. **内容参考**只读浏览，禁止误触编辑（独立只读渲染通道）。
6. 工作台不注册 view-registry → TabNav 零改动；但浏览器后退键不感知内部状态，
   返回保护只覆盖「← 返回」按钮与 tab 切换（dirty 时切 tab 也弹确认）。
