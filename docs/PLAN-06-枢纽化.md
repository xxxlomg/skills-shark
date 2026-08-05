# PLAN-06 — SkillsShark v0.2 枢纽化：Git 分发 × 跨 Agent 引用 × 创作套件

> **状态：✅ 已立项（boss 拍板 2026-08-04）· 开发分支：`v0.2.0`（已从 main 切出）· 技术方案：✅ Pal 细化完成（2026-08-04，各模块实现节 §1.6+/§2.4+/§3.4+/§7）· 修订：R2（2026-08-04，按 Paw 全文评审四条意见修订，见 §9 修订记录）**
> 日期：2026-08-04 · 提出：boss · 整理：Paw（需求/方案）· 架构细化：Pal
> 前置：PLAN-05（.skillpack 格式与打包管线，P1 已完成）
> 关系：卡牌化提案（PROPOSAL-v0.2-卡牌化.md）**暂放不废**——卡牌是呈现层，枢纽是地基，地基打好后卡牌随时可回来。v0.2 周期内不做卡牌趣味化。

---

## 0. 方向陈述

v0.1 的 SkillsShark 是一个**只读的观察站**：扫描各工具的 skills 目录、翻译、打包。
v0.2 要让它变成**枢纽（Hub）**：技能从这里**创作**、从这里**分发到各个 Agent 工具**、从这里**发布给其他用户**。

boss 的三个需求恰好构成完整闭环：

```
创作套件 ──► 规范校验 ──► 引用到 Agent（自用/测试）
    ▲                              │
    │                              ▼
 导入学习 ◄── Git 仓库导入 ◄── 打包发布到 Git 仓库（分享）
```

三个模块的共同设计约束（继承产品宪法）：
- **零后端、零运维**：分发靠 git（用户自己的仓库就是我们的"服务器"），引用靠文件系统链接；
- **机制同构优先**：各家 Agent 的 skills 机制本质相同（扫描目录 + 读 frontmatter），产品顺着同构性做，不逆着生态做；
- **实用优先于趣味**：本计划全部是实用底，趣味层另行排期。

### 0.1 技术底座现状（Pal 补充：细化方案的代码基线）

细化方案基于对现有代码的逐模块核对，关键事实（避免方案与实现脱节）：

| 事实 | 出处 | 对 v0.2 的影响 |
|---|---|---|
| 后端模块：`commands.rs`（19 个 tauri command）/ `config.rs` / `scanner.rs` / `pack.rs` / `import.rs` / `translations.rs` | src-tauri/src/ | 新模块按同构方式新增：`hub.rs`（链接）/ `validate.rs`（校验）/ `authoring.rs`（创作）/ `gitdist.rs`（分发）+ `git.rs`（shell-out 封装） |
| 配置 schema：`{scan_paths: [{path,label,enabled}], llm: {api_key,base_url,model}}`，存 `Roaming\Skills Shark\config.json` | config.rs | §7.1 给出增量 schema 与迁移路径 |
| 扫描：`scan_all_skills` 递归 ≤3 层、有 SKILL.md 即停；app 自有源（builtin/导入）用虚拟 id，外部源用**绝对路径哈希 id**；`fs::canonicalize` 用于 SKILL.md 路径 | scanner.rs | **canonicalize 会穿透 junction/symlink**——现有代码对"同一技能被链接到多个工具"已发生静默折叠（只留扫描序第一个，丢失安装信息）。§2.7 的聚合设计必须显式接管这一行为 |
| 翻译按 skill id 绑定（translations.json + `<id>.md`），已有 rekey 迁移机制 | translations.rs | 聚合后"代表条目"的 id 必须稳定，否则译文孤儿化；§2.7 给出确定性代表选取规则 |
| LLM 调用在**前端**（fetch 流式 SSE），后端只存配置；`get_llm_api_key` 下发明文 key | translate-api.ts / llm-config.ts | 创作套件 AI 模式同样走前端直调（复用管线），后端只预留草稿落盘与校验接口（§3.10/§3.11） |
| URL 导入已实现"GitHub/Gitee archive zip 优先 → git clone 兜底"，有 pending token 机制 | import.rs | Git 分发导入侧复用该模式；archive 通道是私有仓库之外的零 git 降级路径（§1.9） |
| pack 管线：create（temp+rename）/ export / import（版本闸+sha256 自验）/ install / delete 全齐 | pack.rs | 发布 = export 的事务化包装；仓库导入 = clone 后逐包走 `import_pack`，零新增解析代码 |
| 遗留未提交修改：`frontend/src/components/common/Tip.tsx`（Radix Tooltip Portal 重写）+ `AGENTS.md`（v0.2 方向记录） | git status | 处理决定见 §7.5：**单独提交收编，不混入 v0.2 功能提交** |

---

## 1. 模块 A：Git 仓库分发（boss 需求一）

### 1.1 判断

**支持。核心设计决策：不自建注册中心，git 就是注册中心。**

1000 个用户各自维护 skills 仓库的场景下，任何中心化索引都是运营负债。正确形态：
**每个用户的 git 仓库 = 一个去中心化技能货架，SkillsShark 只是货架的客户端。**
发布方 push 自己的仓库，使用方粘贴仓库 URL 导入。产品本身不存任何人的技能目录。

### 1.2 仓库布局约定（"技能货架"格式 v1）

```
my-skill-repo/
├─ index.json              # 货架清单（发布时自动维护，导入时的目录页）
└─ packs/
   ├─ opencode-essentials.skillpack
   └─ frontend-toolkit.skillpack
```

**index.json schema v1**：

```json
{
  "format_version": 1,
  "repo_name": "ruanzh 的技能货架",
  "updated_at": "2026-08-04T12:00:00Z",
  "generator": "SkillsShark 0.2.0",
  "packs": [
    {
      "id": "opencode-essentials",
      "name": "OpenCode Essentials",
      "ver": "1.0.0",
      "path": "packs/opencode-essentials.skillpack",
      "sha256": "…",
      "skill_count": 5,
      "summary_zh": "一句话简介（取 pack.json summary）",
      "updated_at": "2026-08-04T12:00:00Z"
    }
  ]
}
```

- 以 `.skillpack` 为货架单位（复用 PLAN-05 全部成果：sha256 自验、i18n sidecar、版本闸）；
- index.json 让导入方**无需解包全仓库**即可浏览；缺失时降级为扫描 `*.skillpack`。

### 1.3 发布流程

1. 设置里配置「我的技能仓库」：本地仓库路径（可让 App 初始化）+ remote URL；
2. Packs tab 新增动作「发布到仓库」：
   - 拷贝 .skillpack 进仓库 `packs/` → 更新 index.json → `git add/commit/push`；
   - **git 操作一律 shell out 系统 git**，凭据完全走用户自己的 git 配置（SSH/credential manager），App 不碰任何凭据——零运维立场的必然选择；
   - push 被拒 → 自动 `pull --rebase` 重试一次，仍失败则报人话错误；
   - 未检测到系统 git → 明确引导（"装 git 或手动把文件传上去"），不静默失败。
3. 仓库必须已存在于 GitHub/Gitee 等平台（App 不代建远程仓库，README 给 3 步指引）。

### 1.4 导入流程（新入口「从仓库导入」）

1. 粘贴 git URL（https/ssh 均可）；
2. `git clone --depth 1` 到临时目录（浅克隆控体积）；
3. 读 index.json → 渲染货架列表（名称/简介/技能数/版本/更新时间）；
4. 勾选 → 走**现有 pack_import 管线**（零新增解析代码）；
5. 私有仓库：系统 git 弹凭据，成则导入，败则报"需要仓库访问权限"。

### 1.5 发现问题（别人怎么知道你的仓库）

v0.2 **不做中心索引**，靠 URL 口碑传播（build-in-public 内容里带自己的仓库链接）。
留一个零运维后手：未来 App 内置「精选货架」= 随版本发布的静态 JSON，boss 人工挑选，无持续运营承诺。

### 1.6 技术确认：shell-out vs git2/gix（Pal 复核结论）

**结论：采纳 Paw 倾向，shell-out 系统 git。git2/gix 不构成反驳理由，逐条对比：**

| 维度 | shell-out 系统 git | git2（libgit2） | gix（纯 Rust） |
|---|---|---|---|
| 凭据 | ✅ 天然继承用户全部 git 环境：credential manager、ssh-agent、`~/.ssh/config`、代理、hooks、insteadOf 重写 | ❌ libgit2 的凭据回调要自己接；SSH 走 libssh2，默认不读用户 ssh-agent/配置，Windows 上尤甚 | ⚠️ push 侧凭据/传输仍在补全中，生态未稳 |
| 体积/依赖 | ✅ 0 新增依赖 | ❌ 背 libgit2 + openssl/libssh2 原生依赖，NSIS 包体与交叉编译复杂度上升 | ⚠️ 依赖树大 |
| 行为一致性 | ✅ 用户命令行能做的 App 都能做，报错文案可对照 | ❌ 行为与用户本地 git 有微妙差异（换行、LFS、hook） | ⚠️ 同左 |
| 成本 | ⚠️ 解析输出（用 `--porcelain` + 退出码控制）、需检测 git 存在 | 进程内 API | 进程内 API |

shell-out 的两个代价都有成熟解法：
1. **输出解析脆弱** → 只信退出码与 `--porcelain=v1` 机器格式；错误分类用 stderr 关键词匹配（`GIT_TERMINAL_PROMPT=0` 禁交互，避免挂起），匹配不上时原样透传 stderr 截断 300 字——不猜；
2. **子进程阻塞** → git 命令全部放 **async tauri command + `tokio::process::Command`**（tauri 2 原生支持 async command），前端显示进行中态；clone/push 给 120s 软超时 + 可取消（kill child）。

新增 `git.rs` 封装层（所有模块唯一 git 入口）：

```rust
pub struct GitInfo { pub installed: bool, pub version: String }
pub fn detect() -> GitInfo;                          // git --version
pub async fn run(repo: &Path, args: &[&str]) -> Result<String, GitError>;
pub enum GitError {
    NotInstalled,
    AuthFailed(String),      // stderr 命中 authentication/permission 类关键词
    NonFastForward,          // push 被拒 → 触发 pull --rebase 重试
    DirtyWorktree,           // 用户仓库有未提交改动 → 拒绝操作并报人话
    Timeout,
    Other(String),           // stderr 截断透传
}
```

环境变量固定注入：`GIT_TERMINAL_PROMPT=0`（https 无凭据时快速失败而非挂起）、`LC_ALL=C`（Windows 上 git 部分输出受 locale 影响，porcelain 格式本身稳定，双保险）。ssh 协议保留交互弹窗能力——`GIT_TERMINAL_PROMPT` 只影响 https 凭据询问，不影响 GUI 凭据助手与 ssh passphrase agent。

### 1.7 发布事务性（写 pack → index.json → commit → push 的失败回滚）

原则：**push 成功前，仓库工作区必须可完整还原；push 失败后，不自动改写已提交的历史。**

```
publish_pack(pack_id):
  0. 前置检查：git 可用；repo 已配置且是 git 仓库；工作区干净
     （git status --porcelain 非空 → DirtyWorktree，报"请先处理你仓库里的未提交改动"，不代用户 stash）
  1. 备份 index.json 到 <data_dir>/tmp/index.json.bak（若存在）
  2. export_pack → 写到 repo/packs/.tmp-<file>.skillpack（temp 文件）
  3. 读-改-写 index.json：
     - 现有 index.json 解析失败 → 中止，原样不动，报"index.json 无法解析，请手工检查"（绝不覆盖用户手写内容）
     - 按 id 合并：同 id 替换条目（ver/sha256/updated_at 更新），新 id 追加；updated_at = 当前 UTC
     - 先写 index.json.tmp 再 rename（同 pack.rs temp+rename 惯例）
  4. rename temp pack → 正式名
  5. git add -A -- packs/ index.json && git commit -m "publish: <name> v<ver>"
  6. git push
     - 成功 → 删 bak，返回成功（附 remote URL + 文件路径，供 build-in-public 复制）
     - NonFastForward → git pull --rebase → 重 push **一次**；再失败 → 保留本地 commit，
       报"本地已提交但推送失败：<原因>，请手动处理后重试"（不回滚 commit：历史操作交还用户，App 不 reset）
     - 其他失败 → 同保留 commit + 报错
  步骤 1-4 任一步失败（commit 之前）→ 回滚 = 删 temp pack + index.json 从 bak 还原。零残留。
```

要点：**回滚边界划在 commit 之前**。commit 之后的失败只报告不篡改——用户仓库里可能有我们不懂的上下文，自动 reset 是破坏性越权。

### 1.8 导入侧实现（浅克隆 + 临时目录生命周期）

```
repo_browse(url):
  1. git detect；不可用 → 降级 §1.9 的 archive 通道
  2. clone 目标：<data_dir>/tmp/repo-<随机>（不用系统 TEMP：数据目录内便于启动清理与排障）
     git clone --depth 1 --single-branch <url> <dir>（--single-branch 只拉默认分支，体积再减）
  3. clone 后目录总大小检查 ≤ 500MB（防 LFS/大文件仓库撑爆磁盘，超限即删即报）
  4. 解析 index.json → ShelfPreview；缺失/损坏 → 降级扫 packs/*.skillpack 逐包 detect_pack
  5. 注册 pending token（复用 import.rs 的 PENDING 注册表模式），token 绑定 clone 目录
repo_import_commit(token, selected_paths):
  逐个 .skillpack 调 pack::import_pack（版本闸 + sha256 自验全复用）
  全部完成或失败 → 删除 clone 目录 + 注销 token
```

**临时目录清理三重保险**：① 操作结束即删；② token 失效/进程重启遗留 → App 启动时扫 `<data_dir>/tmp/` 全部删除（该目录是 App 私有的启动即清区，不放任何用户数据）；③ clone 用 `--depth 1`，最坏残留体积可控。

### 1.9 无 git 环境 / 私有仓库的降级路径

| 场景 | 行为 |
|---|---|
| 无系统 git + 发布 | 发布按钮禁用 + 引导文案；**降级为"导出 .skillpack 自行上传"**（pack_export 已存在，零成本） |
| 无系统 git + 导入 | 自动改走现有 `preview_url_import` 的 archive 通道（GitHub/Gitee 公开仓库 zip 直下，import.rs 已实现）；私有仓库明确报"需要 git + 仓库访问权限" |
| 有 git + https 无凭据 | `GIT_TERMINAL_PROMPT=0` 快速失败 → 报"需要仓库访问权限（私有仓库）或检查 URL" |
| ssh 协议 | 完全交给系统 git 与用户 ssh 配置，App 不感知细节 |

### 1.10 与现有 pack 管线的衔接（零重复建设）

- 发布 = `pack::export_pack` 的**事务化包装**，不改 export 本身（导出的用户自选文件流程不受影响）；
- 仓库导入 = clone 后逐包 `pack::import_pack` → 进 Packs tab（PLAN-05 D3：只进 Packs，不进扫描库；「安装」才落 imported）；
- index.json 的 `skill_count`/`summary_zh` 取自 pack.json（clone 后可读 zip 内 pack.json，`detect_pack` 已具备）。

### 1.11 模块 A tauri commands

| Command | 签名（简） | 说明 |
|---|---|---|
| `git_status` | `() -> GitStatusInfo` | git 是否可用/版本；仓库是否配置；工作区干净度；ahead/behind（设置页与发布按钮的使能依据） |
| `repo_setup` | `(local_path, remote_url, init_if_missing) -> RepoInfo` | 目录为空则 `git init` + 设 remote + 初始 commit；已有仓库则校验/补 remote |
| `publish_pack` | `(pack_id, message?) -> PublishResult` | §1.7 全流程；async |
| `repo_browse` | `(url) -> ShelfPreview{repo_name, packs[], token}` | §1.8；async |
| `repo_import_commit` | `(token, selected: Vec<String>) -> Vec<PackInfo>` | 逐包 pack_import；async |

### 1.12 模块 A 子里程碑（5-7 天拆法）

| # | 子里程碑 | 验收标准 | 预估 | 状态（2026-08-05 核对） |
|---|---|---|---|---|
| A1 | `git.rs` 封装 + `git_status` | 单测：mock 假 git（PATH 注入）验证 NotInstalled/错误分类；真机：有/无 git 两态 UI 正确 | 1d | 🔶 代码完成；真机两态 UI 未验收 |
| A2 | `repo_setup` + 发布事务（到 commit 为止） | 本地仓库从 0 初始化；发布后 packs/ + index.json 内容正确；故意制造 index.json 损坏 → 中止且零改动 | 1.5d | 🔶 代码完成；损坏中止/零改动未验收 |
| A3 | push + rebase 重试 + 回滚 | 双仓库对推复现 non-fast-forward → 自动 rebase 重试成功；断网 push → commit 保留 + 人话报错 | 1d | 🔶 代码完成；真机 rebase 重试/断网场景未验收 |
| A4 | `repo_browse` + 临时目录生命周期 | 浅克隆公开仓库渲染货架；杀进程重启 → tmp/ 清空；500MB 闸生效 | 1.5d | 🔶 代码完成；tmp 清理/500MB 闸未验收 |
| A5 | `repo_import_commit` + 无 git 降级 | 勾选导入走 pack_import 全链路；卸 git 环境验证 archive 降级 | 1d | 🔶 代码完成；无 git archive 降级未验收 |

---

## 2. 模块 B：跨 Agent 引用 / Hub 安装（boss 需求二）

### 2.1 机制核实（对 boss 推理的确认与修正）

boss 的推理"各家引用 skills 都是 '/' + 短名，本质是文件路径"——**方向正确，精确表述如下**：

- 已读取本机 Claude Code 与 Codex 的官方 skill-creator 原件核实：两家的技能发现机制完全同构——**扫描约定目录 → 读取每个 SKILL.md 的 frontmatter（name + description）→ 模型按 description 自动触发或用户 `/skill-name` 显式引用**；
- `/skill-name` 解析为"skills 目录下的同名文件夹"，是**名称 → 目录**的解析，不是字面全路径缩写，效果等价；
- 关键推论：**技能在哪个目录，哪个工具就能用。** 所以"让一个技能被多个 Agent 使用" = "让它出现在多个工具的 skills 目录里"。这正是本模块的全部原理。

### 2.2 功能定义

现状：SkillsShark 已有多源扫描（多个工具目录，只读）。
升级：**从只读观察站变成可写回的枢纽**——把任意技能"引用"到任意已注册工具的 skills 目录。

**引用方式（三选一，默认链接）**：

| 方式 | Windows | macOS/Linux | 特点 |
|---|---|---|---|
| **目录链接**（默认） | `mklink /J` junction（**无需管理员**） | symlink | 单一事实源：改一处全工具生效；源目录删除会失效 |
| **复制** | 拷贝 | 拷贝 | 独立副本，安全但更新要重拷 |

- 支持**单技能引用**和**整目录/合集引用**（superpowers 这类超级技能包 = junction 整个合集目录）；
- 目标已存在同名 → 复用 PLAN-05 的同名改名逻辑，或明确覆盖确认；
- 提供「转为副本」「解除引用」逃生门（解除时只删链接，绝不删源文件——破坏性边界写死）。

**工具目录注册表**（数据驱动，不硬编码）：

```json
[
  { "id": "claude-code", "name": "Claude Code", "paths": ["~/.claude/skills"], "detect": true },
  { "id": "codex", "name": "Codex", "paths": ["$CODEX_HOME/skills", "~/.codex/skills"], "detect": true },
  { "id": "cursor", "name": "Cursor", "paths": ["~/.cursor/skills"], "detect": false },
  { "id": "qwenpaw", "name": "QwenPaw", "paths": ["<workspace>/skills"], "detect": false }
]
```

- 注册表内置默认项 + 用户可增删（现有 scan_paths 配置升级而来：扫描路径和引用目标统一为"工具目录"概念）；
- Cursor 等工具的实际 skills 目录以实测为准，注册表设计保证改一行 JSON 即可修正；
- **去重视图**：同一技能装在多个工具里时，扫描结果按内容哈希聚合为一个技能 + "已装：Claude ✓ Codex ✓" 徽标，不再显示成 N 个重复项。

### 2.3 使用统计：说真话的分层方案

**能做的（v0.2 做）**：
- **安装广度** = 本 App 的引用记录："此技能被引用到哪些工具、何时引用"。100% 可靠，因为链接是我们建的。技能卡上显示 `Claude ✓ · Codex ✓` 徽标。这是"哪个技能值得传播"的最诚实信号。

**可能能做（P2 验证后再立项）**：
- **真实调用统计**只有工具配合才行。目前唯一有接口的：Claude Code 的 hooks 机制（PreToolUse 可挂脚本，技能调用理论上可作为 tool 事件被钩住，写 JSONL 日志供 App 聚合）。
  - ⚠️ 前提待实测：hook 事件里技能调用的确切形态；
  - ⚠️ 需要改写用户的 `~/.claude/settings.json`，必须显式 opt-in + 改前备份；
  - Codex 等无 hook 接口的工具：做不了就是做不了，不硬做。

**明确不做**：
- 文件访问时间（atime）嗅探——Windows NTFS 默认关闭 last-access 更新，数据不可靠，做出来是假数据，违反"趣味层不许撒谎"同款原则（统计也不许撒谎）。

### 2.4 链接三模式：Rust 实现方案（Pal 细化）

**模式决策表**：

| 平台 | 首选 | 备选 | 兜底 | 理由 |
|---|---|---|---|---|
| Windows | **junction**（`junction` crate） | `std::os::windows::fs::symlink_dir`（检测到开发者模式/管理员时可选） | **copy** | junction 是 NTFS mount-point reparse point，**无需管理员/开发者模式**（symlink 需要 SeCreateSymbolicLinkPrivilege 或 Win10 1703+ 开发者模式）；Win2000 起全版本支持；所有工具的文件 API 天然跟随 |
| macOS/Linux | `std::os::unix::fs::symlink` | — | copy | POSIX symlink 无权限障碍 |
| 跨平台 | — | — | copy（`copy_dir_recursive`） | 用户显式选"副本"时恒可用 |

- crate 选型：**`junction`**（API：`create(src, dst)` / `delete(dst)` / `get_target(dst)` / `exists(dst)`，docs.rs 确认活跃）。不走 `mklink /J` shell-out——避免 UAC/编码问题，纯 Rust 实现更可控；§2.2 表格中的 `mklink /J` 仅作为机制说明，实现不 shell-out；
- junction 约束：目标必须是**本地绝对路径目录**（源目录在链接创建前必须已存在；不支持 UNC/相对路径——源都在本地盘，约束无实际损失）；
- 新增 `hub.rs` 平台隔离层：

```rust
pub enum LinkKind { Junction, Symlink, Copy }

#[cfg(windows)]  create_link(src, dst) -> Result<LinkKind>   // junction::create → 失败 Err
#[cfg(unix)]     create_link(src, dst) -> Result<LinkKind>   // std symlink
fn link_target(dst) -> Option<PathBuf>      // Windows: junction::get_target ∪ fs::read_link；POSIX: fs::read_link
fn is_our_link(dst) -> bool                 // symlink_metadata 查 REPARSE_POINT/symlink 属性
fn remove_link(dst) -> Result<()>           // 只删链接本体（见 §2.5）
```

### 2.5 链接生命周期：三条铁律的实现保证

1. **解除引用只删链接，绝不碰源**：
   - Windows：先 `symlink_metadata` 确认 `FILE_ATTRIBUTE_REPARSE_POINT` 置位，再 `fs::remove_dir(dst)`（RemoveDirectoryW 对 reparse point 只摘链接不递归）；
   - POSIX：`symlink_metadata` 确认是 symlink，用 `fs::remove_file`（`remove_dir` 对目录 symlink 会 ENOTDIR）；
   - **全代码库禁止对链接路径调用 `fs::remove_dir_all`**——hub.rs 内加 debug_assert 防线，code review 检查项写进 AGENTS.md；
2. **断链检测**：links.json 逐条核对——目标不存在 / 目标存在但非链接 / 链接指向与记录不符 → 标记 `broken`，UI 红色徽标 + 一键「重建链接」（源还在）或「移除记录」（源也没了）。扫描侧天然看不到断链（junction 失效后 is_dir()=false，直接跳过），所以**断链只能靠 links.json 台账发现**，这是台账必须存在的根本理由；
3. **转副本**：读链接 → 记下 target → `remove_link` → `copy_dir_recursive(target → dst)` → links.json 条目 kind 改为 Copy。顺序保证任何时刻至少一份内容存在。

**台账：`Roaming\Skills Shark\links.json`**（文件系统是真相，台账是索引 + 断链检测依据）：

```json
{ "version": 1, "links": [
  { "id": "<sha256 前 12 位>",
    "source": "D:/vault/skills/pdf",          // 规范目录（绝对路径，正斜杠存储同现有惯例）
    "target": "C:/Users/x/.claude/skills/pdf", // 链接/副本所在位置
    "tool_id": "claude-code",
    "kind": "junction",                        // junction | symlink | copy
    "content_hash": "…",                        // 创建时树哈希，供"源已变动"提示
    "created_at": "…", "last_verified": "…" }
]}
```

启动时轻量对账（与 tmp 清理同一时机）：台账有、文件系统不符 → 标 broken；文件系统有链接、台账没有（用户在别处手工建的）→ 不纳管、不报错，只在 Hub 页显示"外部链接"灰标。

### 2.6 工具目录注册表：`scan_paths` → `tools` 统一升级

读取（扫描）与写入（引用目标）合一为「工具」概念。配置 schema 增量（§7.1 汇总）：

```json
{
  "tools": [
    { "id": "claude-code", "name": "Claude Code",
      "paths": ["~/.claude/skills"],            // 多候选路径，扫描时逐个展开；引用目标 = 第一个存在的路径，都不存在时创建 paths[0]
      "builtin": true, "enabled": true,
      "linkable": true },                       // builtin/imported 两个 app 自有源 linkable=false
    { "id": "codex", "name": "Codex CLI",
      "paths": ["$CODEX_HOME/skills", "~/.codex/skills"],   // 按序解析：环境变量优先
      "builtin": true, "enabled": true, "linkable": true }
  ]
}
```

- 内置注册表 = §2.2 已核实的各家真实目录清单（含 `$CODEX_HOME` 环境变量展开 + `~` 展开，新增 `expand_path()` 工具函数），可随版本追加新工具；
- **迁移**：`AppConfig` 加载时若存在旧 `scan_paths` 字段 → 按 label 映射内置工具 id，未能映射的自定义项转为 `builtin:false` 的 tools 条目；迁移后 `scan_paths` 字段只读兼容一个版本（读时忽略、写时丢弃）；
- **行为不变量**：builtin/imported 扫描源语义与 v0.1 完全一致（虚拟 id、source_deleted 逻辑不动）——tools 注册表只是把"扫描路径从哪来"换了个更丰富的来源；
- 自定义工具：`hub_add_tool(name, paths[])`，linkable=true，删除时检查名下 links.json 条目 → 有则提示先解除引用（或用户勾选"一并移除记录"）。

### 2.7 内容哈希聚合：Skill 结构与 scan_skills 的改动

**现状问题（代码核实）**：`fs::canonicalize(skill_md)` 会穿透 junction/symlink 解析到真实路径 → 同一源技能被链接到 N 个工具时，现有代码**静默折叠成一张卡**（seen_ids 去重，只留扫描序第一个），安装信息全丢。聚合设计就是把这个偶然行为变成显式能力：

```rust
pub struct InstallInfo {
    pub tool_id: String,
    pub scan_label: String,
    pub source_path: String,      // 该工具侧的路径（链接位置）
    pub link_kind: Option<String> // junction/symlink/copy；普通目录 None
}

pub struct Skill {
    // …现有字段不动（id/name/description/emoji/title_zh/…）
    pub content_hash: String,          // 树哈希：sha256( sorted (相对路径, 文件sha256) )，复用 pack.rs collect_files 的哈希函数
    pub installations: Vec<InstallInfo>,
}
```

- `scan_all_skills` 改为两阶段：① 照常全量扫描（含链接目录——is_dir() 天然跟随 junction），每条命中记为 occurrence；② 按 content_hash 分组，组内产出**一张卡**；
- **代表选取（确定性，保证翻译绑定稳定）**：按 (扫描源在 config 中的顺序, 路径字典序) 排序取第一个 occurrence 为卡片主体，其 id 沿用现有 id 规则（外部源 = 路径哈希）——translations.json 按 id 绑定不受影响；其余 occurrence 进 installations；
- 已知边界（接受，见 §6 风险 R7）：用户停用某扫描源可能使"代表"翻转为另一个安装点 → id 变化 → 译文看似丢失。缓解：翻转后的新 id 若命中既有孤儿翻译（translations.rs 已有孤儿扫描），提示"译文属于该技能的另一安装位置，是否迁移"——复用 rekey 机制，零新存储。

### 2.8 Hub 页交互契约（后端视角）

- `hub_link_skill(source, tool_id, mode: auto|link|copy, overwrite?)`：source 可为单技能目录（含 SKILL.md）或整集合目录；目标名 = 源目录名，冲突默认改名（`-2`，同 PLAN-05 惯例），`overwrite=true` 时先解除/删除旧条目（旧条目是链接则 remove_link，是真实目录则拒绝并报错——不代用户删第三方内容）；
- 链接成功后触发一次增量扫描（前端现有 scan_skills 调用即可，无需事件机制）；
- 卡片上 installations 渲染为徽标组（"已装入 Claude Code / Codex CLI"），点击可跳 Hub 管理；
- 单技能「解除引用」= remove_link + 台账移除；集合级解除 = 对集合下每个链接逐一执行（台账按 source 前缀匹配）。

### 2.9 使用统计：本期只做"安装广度"（boss 待定项的留白边界）

以 §2.3 分层方案为讨论底稿，boss 拍板"待定"后，本期实现边界锁死如下：

- 唯一允许的实现：Hub 卡片上的 `installations.len()` + 徽标列表——**纯展示**，零存储、零上报、零 hooks（安装广度本就落在 links.json 台账里，是引用机制的副产品，不新增任何采集逻辑）；
- **以下内容本期一律不做**：真实调用计数（Claude Code Hooks 等，§2.3 的 P2 档）、atime 嗅探、任何上传/聚合/遥测。待 boss 进一步讨论后另立小节。

### 2.10 模块 B tauri commands

| Command | 签名（简） | 说明 |
|---|---|---|
| `hub_list_tools` | `() -> Vec<ToolInfo>` | 注册表 + 各路径存在性 + 名下技能数 + linkable 标志 |
| `hub_add_tool` / `hub_update_tool` / `hub_remove_tool` | 常规 CRUD | remove 时校验名下链接（§2.6） |
| `hub_link_skill` | `(source_dir, tool_id, mode, overwrite) -> LinkResult` | 建链/建副本 + 台账登记 |
| `hub_unlink` | `(target_path) -> ()` | 仅删链接本体（§2.5 铁律） |
| `hub_convert_to_copy` | `(target_path) -> ()` | §2.5 转副本 |
| `hub_links_status` | `() -> Vec<LinkEntry+status>` | 台账 + 对账结果（ok/broken/external） |
| `scan_skills`（改造） | 返回聚合后的 Skill（§2.7） | 既有命令，签名兼容、字段新增 |

### 2.11 模块 B 子里程碑（5-7 天拆法）

| # | 子里程碑 | 验收标准 | 预估 | 状态（2026-08-05 核对） |
|---|---|---|---|---|
| B1 | tools 注册表 + scan_paths 迁移 | 旧 config 自动迁移不丢自定义路径；$CODEX_HOME/~ 展开正确；内置注册表工具全部识别 | 1d | ✅ 完成（6ff97c3） |
| B2 | hub.rs 链接层 + junction 单测 | Windows junction/POSIX symlink 建删往返；remove_link 对真实目录必须报错（防误删单测） | 1.5d | ✅ 完成（5a2e607） |
| B3 | links.json 台账 + 断链检测 | 手工删源 → hub_links_status 报 broken → 重建链接恢复 | 1d | ✅ 完成（efaffab） |
| B4 | 聚合扫描 + Skill 结构 | 同一技能链接进 2 工具 → 一张卡 + 两枚徽标；译文绑定不丢；代表翻转提示可迁移 | 1.5d | ✅ 完成（19dd7c9 + bc16f46 徽标） |
| B5 | Hub 页命令接线 + 转副本 | 全模式（link/copy/解除/转副本/集合级）手工走查一遍；导航结构走 §7.6 插槽（视图注册表数据驱动，不硬编码 TabNav——IA 由 Paw 交互稿覆盖） | 1.5d | ✅ 完成（09e8c05/20e67cd/1118538/f6310a1 收尾，干净实例走查过） |

---

## 3. 模块 C：创作套件 + 规范校验（boss 需求三）

### 3.1 官方原件考古结论

已逐字读取本机两份官方 skill-creator（`~/.claude/skills/skill-creator`、`~/.codex/skills/.system/skill-creator`），规则全部挖到手，**抄方法论而非抄代码**：

**两家共识（创作原则，将固化进 AI 生成 prompt 与模板）**：

| 原则 | 内容 |
|---|---|
| description 即触发器 | 模型只凭 name + description 决定是否使用；必须写清"做什么 + 何时用"，"何时用"只写 frontmatter 不写正文（正文触发后才加载，写了没用） |
| 文风 | 正文全篇祈使句/不定式（"To do X, do Y"），不用第二人称 |
| 渐进披露 | 三级加载：元数据（~100 词，常驻）→ 正文（<5k 词，触发后）→ 资源文件（按需）；正文超 500 行要拆分 |
| 资源三分法 | `scripts/`（要确定性执行的代码）、`references/`（按需加载的文档）、`assets/`（产出物素材，不进上下文） |
| 命名 | hyphen-case（小写字母数字连字符），文件夹与 name 完全一致，动词开头，必要时带工具命名空间（如 `gh-address-comments`） |

**校验规则（从两份 quick_validate.py 提取，已差异比对）**：

| 规则 | Claude 版 | Codex 版 | 我们采用 |
|---|---|---|---|
| SKILL.md 存在、frontmatter 格式 | ✅ | ✅（严格 YAML 解析） | 严格版 |
| name / description 必填 | ✅ | ✅ | ✅ |
| name hyphen-case、不首尾连字符、不双连字符 | ✅ | ✅ | ✅ |
| name ≤ 64 字符 | ❌ | ✅ | ✅ |
| description 无尖括号 | ✅ | ✅ | ✅ |
| description ≤ 1024 字符 | ❌ | ✅ | ✅ |
| frontmatter 字段白名单 | ❌ | ✅ `{name, description, license, allowed-tools, metadata}` | 按生态分治（修订 R2-d）：CL 白名单 = Codex 基线 ∪ {user-invocable, disable-model-invocation}（Claude Code 合法布尔字段，见 §3.5 CL-02）；CX 白名单 = 基线五字段，两字段在 Codex 侧报未知属正确行为，由兼容矩阵分流 |

**Codex 特有扩展（选做支持）**：
- `agents/openai.yaml` = UI 元数据层（给 Codex 界面渲染用，非 Agent 读取；**字段全部位于 `interface:` 之下**，官方 schema 见 references/openai_yaml.md，修订 R2-a）：
  - `interface.display_name` / `short_description`（25-64 字符）/ `default_prompt`（必须写成 "Use $skill-name to …" 句式）——三个文案字段为默认产出；
  - `interface.icon_small` / `icon_large`（assets 相对路径，默认 `./assets/`）/ `brand_color`（hex）——可选，**用户没提供就不生成**（官方原则：可选 interface 字段仅在用户明确提供时才写入）；
  - 字符串加引号、键不加引号；
  - 我们的生成方式：AI 按 SKILL.md 内容产出三个文案字段 → App 按规范写 YAML（格式简单，原生实现，不必调官方 py 脚本）。

**两家差异点（产品机会）**：官方校验器只管自家生态，而用户的技能往往要同时喂给 Claude 和 Codex。
→ 我们做**跨生态兼容矩阵**：一个技能给出 `Claude ✓ / Codex ⚠(原因)` 的并排报告。这是官方工具给不了的差异化。

### 3.2 创作向导流程

1. 「新建技能」入口 → 对话框：
   - 名称（用户输入自动 hyphen-case 规范化，"Plan Mode" → `plan-mode`）；
   - 主题描述（做什么、典型用法、需要的资源——三行引导文案，抄官方 Step 1 的提问设计）；
   - 创建位置：App 管理库 / **直接建进某工具的 skills 目录**（建完即被该工具发现，零搬运）；
2. 两种生成模式：
   - **模板模式**（无 LLM 也可用）：SKILL.md 骨架 + TODO 占位 + 按需的 scripts/references/assets 空目录（对齐官方 init_skill.py 行为）；
   - **AI 模式**（复用现有 LLM 管线）：主题 + 要点 → AI 产出 frontmatter + 正文初稿，§3.1 的原则全部作为 prompt 硬约束 → 产出后立即过校验器；
3. 编辑：frontmatter 表单化 + YAML round-trip 保留未知字段（规格与验收标准见 §3.14 / C10；原卡牌提案锁定范围，现已收编进模块 C）；
4. 实时校验面板：error（阻断）/ warning（提醒，如正文超 500 行、含 README.md 等 Codex 禁止文件）+ 兼容矩阵；
5. 可选生成 `agents/openai.yaml`（Codex 界面增强）。

**校验的两个语境（重要区分）**：
- 创作/打包时 = **严格模式**（unknown key 算 error，引导用户写出干净技能）；
- 扫描来的第三方技能 = **仅诊断不阻断**（warning 级提示，导入永远开放，延续 PLAN-05 D9 的开放立场）。

### 3.3 关于内置 Python：反对 v0.2 内置

boss 提出"规范校验及后期功能可能要内置 py3"，我的判断是**本期不内置**：

1. 校验规则 = 字符串/YAML 检查，Rust 原生实现（serde_yaml）完全覆盖，为一个校验器背 30-50MB 的 Python 运行时不划算；
2. 技能里的 `scripts/*.py` 是**给 Agent 执行的，不是给 SkillsShark 执行的**——运行时是 Agent 环境的职责；
3. 官方 quick_validate.py 是脚本不是依赖，规则读出来重写即可（本计划 §3.1 已完成提取）。

**重启条件**：未来若出现 SkillsShark 自己要执行代码的功能（如技能沙箱试运行），先做"检测系统 python + 引导安装"，内置打包仍是最后手段。此条已获 boss 拍板（§8 拍板记录 B2），Pal 架构侧复核结论见 §3.4。

### 3.4 校验器技术选型（Pal 细化：YAML 库现状核实）

**核实结论（2026-08）：`serde_yaml` 0.9 已被 dtolnay 归档停维护；其 fork `serde_yml` 也已废弃（RUSTSEC-2025-0068，2026-05 归档，自述迁移指引）。当前活跃的 serde 兼容替代：`serde_yaml-ng`（serde-yaml 的独立延续，API 基本 drop-in）与 `noyalib`（纯 Rust、forbid(unsafe)、提供 compat-serde-yaml feature）。**

**选型决定：`serde_yaml-ng`。** 理由：
1. API 与 serde_yaml 0.9 同源，frontmatter 解析/报错定位（Spanned）直接可用；
2. 维护活跃，避开 serde_yml 的审计告警链（cargo audit 干净——对"零运维"产品，依赖告警就是运维债）；
3. 若未来 serde_yaml-ng 也停摆，noyalib 的 compat feature 可零调用点切换。

校验器独立模块 `validate.rs`，不依赖扫描管线（可校验任意目录，包括未纳入扫描的草稿目录）。§3.3 的 Rust 原生路线由此成立：解析层有活跃维护的纯 Rust 方案，无需 Python。

### 3.5 规则表配置化结构

规则以**数据 + 检查函数**组织，内置规则表编译进二进制（`include_str!` 嵌入 JSON，避免外部文件丢失/篡改），保留 version 字段供未来外置覆盖：

```rust
struct RuleSpec {
    id: &'static str,            // "FM-01" / "CL-03" / "CX-02"
    level: Level,                // Error | Warn | Info
    applies_to: Eco,             // All | Claude | Codex
    check: fn(&SkillFileset) -> Option<Issue>,
}
```

规则集（§3.1 校验规则对照表的落地映射，每条有稳定 id 供 UI 引用）：

| 规则组 | id 段 | 内容 |
|---|---|---|
| frontmatter 基础 | FM-01..07 | YAML 可解析；description 存在/非空/≤1024；name 格式 `^[a-z0-9-]+$`（仅 Codex 生态报）；user-invocable/disable-model-invocation 类型检查（必须为布尔——**前提是二者是 CL 白名单合法字段**（§3.1，修订 R2-d），FM 层只做类型检查，绝不报"未知字段"） |
| Claude 生态 | CL-01..05 | name 与目录名一致（Warn）；白名单 = {name, description, license, allowed-tools, metadata, **user-invocable, disable-model-invocation**}，名单外字段列表化提示（严格模式升 Error）；allowed-tools 字符串形态提示 |
| Codex 生态 | CX-01..04 | 白名单 = {name, description, license, allowed-tools, metadata}（Codex quick_validate.py 基线）——user-invocable/disable-model-invocation 在此报未知字段是**正确行为**（矩阵分流：Claude pass / Codex warn，修订 R2-d）；未知字段按严格/诊断分流；openai.yaml 存在性检查**闸控于 `agents/` 目录存在**（修订 R2-e，纯 Claude 技能不报噪音）；default_prompt 含 `$skill-name`（仅对含 openai.yaml 的技能，「缺」= openai.yaml 缺失）；short_description **≤64 字符**（豁免 25 下限，修订 R2-e：官方原件实测 24 字符） |
| 文件层 | FS-01..05 | SKILL.md 存在；体积阈值提示（>500KB Warn）；引用文件存在性（Info）；.py 无 shebang 提示（Info）；目录深度 |

### 3.6 严格 / 诊断双轨 + 兼容矩阵输出

- **诊断模式（默认，浏览/创作实时反馈）**：全规则跑，未知字段只提示不阻断，永不 fail；
- **严格模式（发布前闸）**：未知字段、Codex name 规范等升级为 Error，`passed=false` 阻断（可被显式 force 覆盖，见 §3.7）；
- 统一输出结构（`skill_validate` 返回，前端按 mode 渲染）：

```json
{
  "mode": "strict",
  "passed": false,
  "issues": [
    { "rule_id": "CX-02", "severity": "error", "message": "字段 'category' 为 Codex 未知字段",
      "path": "SKILL.md", "hint": "移入 references/ 或从 frontmatter 删除" }
  ],
  "matrix": {
    "claude": { "verdict": "pass", "notes": [] },
    "codex":  { "verdict": "warn", "notes": ["default_prompt 未含 $skill-name"] }
  }
}
```

矩阵 verdict 三态：pass / warn（有问题但不阻断）/ fail（严格模式下有 Error）。前端技能详情显示 2×3 状态徽章。

### 3.7 与 pack_create 的集成点（"打包前强制校验？"——结论）

**结论：强制校验，但留显式逃生门。**

```
create_skill_pack 新增参数 force: bool = false
  1. 对每个入选技能目录跑 validate(strict)
  2. 任一技能有 Error 且 force=false → 拒绝创建，返回结构化报告
     （新错误码 PACK_VALIDATION_FAILED + issues 数组，前端渲染问题清单弹窗）
  3. force=true → 校验报告随包写入 pack.json 的 metadata.validation_warnings
     （下游导入方可见"这个包是带伤发布的"，责任透明）
  4. Warn 永不阻断
```

同理 `publish_pack`（§1.7 步骤 0 之后）：包内技能已带校验记录则跳过重校验（发布的是 pack 而非裸目录），未带记录（v0.1 旧包）→ 解包跑诊断模式并提示。

### 3.8 模块 C-地基 tauri commands 与子里程碑

| Command | 签名（简） | 说明 |
|---|---|---|
| `skill_validate` | `(path, mode: strict|diagnostic) -> ValidationReport` | 独立可用（创作页实时校验也走它） |

| # | 子里程碑 | 验收标准 | 预估 | 状态（2026-08-05 核对） |
|---|---|---|---|---|
| C1 | validate.rs 骨架 + FM 规则组 | 对 §3.1 两份官方原件做 fixture：Claude 版全绿、Codex 版按预期报差异项 | 1.5d | ✅ 完成（f6310a1，fixture 回归在 109 单测内） |
| C2 | CL/CX 规则组 + 双轨模式 | 构造未知字段样本：诊断=提示、严格=Error；fixture 回归 | 1d | ✅ 完成（71c07e0） |
| C3 | 矩阵输出 + skill_validate 接线 | 前端徽章按矩阵渲染（本里程碑含最小 UI） | 1d | 🔶→✅ 代码+前端接线完成（2026-08-05）：ValidationBadges 组件入 DetailSheet，mock 四样本三态走查过、后端 serde 形状逐字段核对一致；**真机验收随 app 重启一并做** |
| C4 | pack_create 集成 + force 逃生门 | 带错技能打包被拒并出清单；force 后 warnings 入 pack.json 可查 | 1d | 🔶→✅ 代码+前端接线完成（2026-08-05）：后端单测含 force 写 warnings/export 透传；mock 走查拒绝清单+「仍要打包」闭环过；**真机抽验随 app 重启一并做** |

### 3.9 两种落地位置的路径处理（Pal 细化）

| 落点 | 物理路径 | 扫描身份 | 适用 |
|---|---|---|---|
| **App 管理库** | `Roaming\Skills Shark\authored\<name>\` | 新增 app 自有源 `authored`（与 builtin/imported 同构：虚拟 id token `authored`，source_path=相对路径） | 草稿期、未确定装进哪个工具时；后续「引用到工具」走 §2.8 hub_link_skill，闭环打通 |
| **直接进工具目录** | 目标 tools 条目的写入路径（第一个存在的 paths，都不存在则创建 paths[0]） | 普通外部源（绝对路径 id） | 明确"这就是给 Claude Code 写的"时一步到位 |

- authored 目录注册进 tools 注册表（`builtin:true, linkable:false, app_owned:true`），扫描/翻译/删除语义全部复用 imported 的既有实现——**零新扫描代码**；
- 命名冲突：目标目录已存在 → 拒绝并要求改名（不自动 `-2`：创作是主动行为，静默改名会让用户找不到自己的文件）。

### 3.10 后端命令设计

| Command | 签名（简） | 说明 |
|---|---|---|
| `skill_new` | `(name, location: {Authored} \| {Tool(tool_id)}, topic?) -> CreateResult{path, skill}` | 模板模式：写 SKILL.md 骨架（frontmatter 预填 name/description 占位）+ 空 references/；写完立即跑诊断校验返回报告 |
| `skill_commit_draft` | `(location, draft: SkillDraft) -> CreateResult` | AI 模式落盘入口（§3.11）；写入前路径归属检查（必须落在已注册 tools 路径或 authored/ 之下，防任意路径写） |
| `skill_write_file` | `(skill_dir, rel_path, content) -> ()` | 编辑器保存用（整文件写）；rel_path 禁止 `..` 逃逸 + 落点同上的归属检查。⚠️ frontmatter 表单编辑**不走这里**，走 `skill_edit_frontmatter`（§3.14，防全量重写丢未知字段） |
| `skill_edit_frontmatter` | `(skill_dir, edits) -> EditResult` | §3.14 行级外科手术编辑；未知字段/注释字节级保留 |
| `openai_yaml_generate` | `(skill_dir, fields: {display_name?, short_description?, default_prompt?, icon_small?, icon_large?, brand_color?}) -> WriteResult` | §3.12 原生 YAML 写入；默认只写三个文案字段，icon/brand_color 仅在用户提供时写入 `interface:` 下（修订 R2-a） |
| `skill_validate` | 复用 §3.8 | 创作页每次保存后实时调用（诊断模式） |

`SkillDraft` 数据结构（AI 生成的交付契约，前端 LLM 产出 → 后端落盘）：

```rust
struct SkillDraft {
    name: String,                    // 已按 ^[a-z0-9-]+$ 规范化（前端生成时约束 + 后端兜底）
    description: String,             // ≤1024
    body: String,                    // SKILL.md 正文（frontmatter 由后端组装，防格式漂移）
    resources: Vec<(String, String)> // (相对路径, 内容)，references/ 下的附加文件
}
```

**职责切分（与翻译管线同构）**：LLM 调用在前端（流式可见、复用 llm-config），后端只管校验与落盘——零后端立场不破，且 prompt 迭代不需要发版。

### 3.11 AI 生成集成点（接口预留，prompt 由 Paw 后补）

- 前端新增 `src/lib/authoring-api.ts`：与 `translate-api.ts` 同构（SSE 流式、复用 `getLlmSettings`/`resolveLlmConfig`）；
- **prompt 插槽**：`AUTHORING_SYSTEM_PROMPT` / `buildAuthoringUserPrompt(topic, context)` 两个常量/函数占位，内部为 TODO 标记的初版占位文本，Paw 提供创作 prompt 后直接替换常量，不动调用链；
- 输出解析约定：LLM 返回 JSON（name/description/body/resources），前端解析失败 → 展示原文供手工复制，不静默降级；
- 生成完成 → 前端调 `skill_commit_draft` → 后端落盘 + strict 校验 → 问题清单直出创作页（"AI 写的也要过闸"，与人工创作同权）。

### 3.12 openai.yaml 原生生成（格式约束的硬实现）

不引入通用 YAML 序列化器（会把不该加引号的键也加引号），**手写专用 emitter**。**输出严格对齐官方 references/openai_yaml.md schema（修订 R2-a）：字段全部位于 `interface:` 之下，不存在顶层 `branding:` 键**：

```rust
// 输出形态（键不加引号；字符串值一律双引号 + 转义；块标量不用）：
// interface:
//   display_name: "PDF 处理专家"
//   short_description: "从 PDF 提取文本与表格"
//   default_prompt: "Use pdf-toolkit to …"
//   icon_small: "./assets/icon-small.png"      # 可选，仅用户提供时写入
//   icon_large: "./assets/icon-large.svg"      # 可选，仅用户提供时写入
//   brand_color: "#880000"                     # 可选，仅用户提供时写入
fn emit_openai_yaml(f: &OpenAiFields) -> String;
```

硬约束（写前校验，违反即拒写）：
1. **默认只产出三个文案字段**（display_name / short_description / default_prompt）；icon_small / icon_large / brand_color **仅在用户明确提供时**写入 `interface:` 下（官方原则：可选 interface 字段不得臆造）；
2. `default_prompt` 必须包含子串 `$skill-name`（§3.1 Codex 原件规则，§3.5 CX-03 同规则复用）；
3. `short_description` 25-64 字符（不足/超长报 error，UI 给字数计数）；
4. icon_small / icon_large 值为**相对技能目录的资源路径**（官方默认 `./assets/`），不是图标名字符串；UI 若引导用户选图，落盘前归一为 `./assets/<file>` 并确认资源文件存在（不存在则 Warn，不阻断——文件可能后补）；
5. 字符串值统一 `"` 包裹，内部 `"` `\` `\n` 标准转义；键名与缩进（2 空格）由 emitter 代码固定，用户输入无法破坏结构；
6. 已存在 openai.yaml → 默认拒绝覆盖，`overwrite=true` 时先备份 `.bak`。

范围注记：官方 schema 还有 `dependencies`（MCP 工具依赖）与 `policy.allow_implicit_invocation` 两个顶层节，v0.2 生成器**不产出**（ Codex 高级配置，非文案增强），校验侧也不报其缺失。

写入位置：技能目录下 `agents/openai.yaml`（§3.1 约定）。生成时机：创作页「Codex 兼容」开关，或已有技能的详情页手动触发。

### 3.13 模块 C 子里程碑（6 天拆法）

| # | 子里程碑 | 验收标准 | 预估 | 状态（2026-08-05 核对） |
|---|---|---|---|---|
| C5 | authored 源 + skill_new 模板模式 | 新建→出现在扫描（authored 徽标）→可被引用到工具 | 1d | 🔶→✅ 代码+前端接线完成（2026-08-05）：authored 源注册（default/ensure/路径三处）+ skill_new 纯函数核心 + 3 单测；前端 NewSkillDialog + 技能库入口 + authored 徽标；mock 走查全闭环（新建→创作分类→徽标→同名拒→LinkDialog 可引用）；**真机验收随 app 重启一并做** |
| C6 | skill_commit_draft + skill_write_file（含路径归属安全） | 路径逃逸用例（../、绝对路径、未注册目录）全部被拒 | 1d | ✅ 完成（2026-08-05）：authoring.rs 归属基线（roots 参数化）+ 6 单测全拒逃逸用例（`../`/绝对/未注册/ sneak `../`）+ 正常嵌套写入通过；命令已注册 |
| C7 | authoring-api.ts 骨架 + prompt 插槽 | 用占位 prompt 跑通"输入主题→流式生成→落盘→校验报告"全链路 | 1.5d | 🔶→✅ 骨架+链路完成（2026-08-05）：authoring-api.ts（prompt 插槽/parseDraft/generateAndCommit）+ callLLMStream 导出复用 + NewSkillDialog AI 模式（主题+落点双选+流式预览）；mock 全链路走查过（落盘→校验全绿→扫描可见）；真 LLM 链路随 app 重启+API Key 验收 |
| C8 | openai.yaml emitter + 约束校验 | 格式快照测试（引号/缩进/$skill-name 断言）；覆盖写备份生效 | 1d | ✅ 完成（2026-08-05）：authoring.rs emitter（官方顺序/引号/2 空格缩进/转义）+ 6 单测（快照断言、$skill-name 拒、25–64 拒、overwrite .bak、裸 icon 归一 + warn、归属闸）；官方 openai_yaml.md 入后端 mock 快照；前端触发入口随 C9 创作页接 |
| C9 | 创作页 UI 接线（表单/编辑/双落点选择） | 手工走查：模板 + AI 两模式 × 两落点；导航走 §7.6 插槽（不硬编码 TabNav） | 1.5d | 🔶→✅ 完成（2026-08-05）：view-registry 注册 create（weight 30，导航自动渲染）+ CreationView（authored 列表+frontmatter 表单+正文编辑+Codex 三件套）+ NewSkillDialog 双落点共用；mock 走查过（模板×authored/claude-code、AI 链路、C8 拒+过）；**真机走查随 app 重启** |
| C10 | **结构化编辑：frontmatter 表单化 + YAML round-trip 保留未知字段**（§3.14，修订 R2-b） | **验收硬标准：编辑含未知字段的第三方 SKILL.md，保存后未知字段逐字保留**（fixture 字节级 diff 测试）；创作页与详情页表单编辑共用同一后端命令 | 1.5d | ✅ 完成（2026-08-05）：authoring.rs edit_frontmatter_checked 行级外科手术（零新依赖）+ 5 单测（含未知字段/注释/多行块字节级 diff fixture，硬标准达标）+ skill_edit_frontmatter 命令；创作页 CreationView 与详情页 MetaEditForm 共用同一命令，mock 双入口走查过 |

### 3.14 结构化编辑：frontmatter 表单化 + round-trip 保真（修订 R2-b 新增）

**规格来源**：卡牌提案 §5「不动的实用底」中已锁范围的编辑能力。卡牌暂放后该规格失去落点，现收编进模块 C——否则用户用我们编辑一次第三方 SKILL.md，别家工具写入的元数据（Claude 的 `metadata:`、第三方自定义字段、注释）就丢一次，直接违背枢纽定位。

**后端命令**：

| Command | 签名（简） | 说明 |
|---|---|---|
| `skill_edit_frontmatter` | `(skill_dir, edits: Vec<{key, op: set\|delete, value?}>) -> EditResult{new_frontmatter, validation}` | 外科手术式编辑，写后跑诊断校验一并返回；路径归属检查同 skill_write_file |

**round-trip 策略（决定：行级外科手术，不做全量解析重序列化）**：

1. serde_yaml-ng 解析 frontmatter 仅用于**定位**：识别顶层 key 及其行范围（含多行块标量/嵌套子树的完整 span）；
2. 被修改的 key → 原行范围整段替换为新值；新增 key → 追加到 frontmatter 末尾；删除 key → 移除整段；
3. **其余字节不动**——未知字段、注释、引号风格、空行原样保留；
4. 兜底：定位失败（非常规结构，如锚点/别名）→ 拒写并报错，**绝不降级为全量重写**（降级即静默丢数据，比拒写更糟）。

**已知边界**：行级替换保证"未知字段逐字保留"的验收标准，但对*被编辑*字段本身会规范化其 YAML 形态（如加引号）——这是预期行为，不是缺陷。

**前端**：已知字段（name/description/license/allowed-tools/user-invocable/disable-model-invocation 及白名单内其余字段）表单化输入；表单无法表达的字段显示为只读原始 YAML 预览 + 提示"该字段请用文本编辑"（整文件编辑仍走 `skill_write_file`，与表单编辑互斥入口，避免两条写路径互相覆盖）。

---

## 4. 闭环故事（v0.2 的一句话卖点）

> **"在一个地方写技能，所有 AI Agent 都能用，所有人拿得到。"**

- 写：创作套件 + 官方级校验（模块 C）
- 用：一键引用到 Claude/Codex/Cursor（模块 B）
- 传：打包发布进自己的 git 仓库，别人一个 URL 导入（模块 A）

对 1000 人场景的回答：不需要平台方运维任何东西——每个人的 GitHub 仓库就是自己的技能商店，SkillsShark 是人人可用的商店客户端。

---

## 5. 工作量与排序

| # | 项 | 估时 | 依赖 |
|---|---|---|---|
| 1 | **Hub 引用**（模块 B 核心：链接管理 + 工具注册表 + 去重视图 + 安装广度徽标） | 5-7 天 | 无，独立价值最高 |
| 2 | **规范校验器**（§3.1 规则表 + 双模式 + 兼容矩阵） | 2-3 天 | 无，创作/打包的地基 |
| 3 | **创作套件**（向导 + 模板/AI 生成 + openai.yaml） | 4-6 天 | #2（产出即校验）；AI 模式依赖 LLM 配置 |
| 4 | **Git 分发**（仓库配置 + 发布流 + index.json + URL 导入） | 5-7 天 | 有包可发才有意义，压轴 |

合计约 3-4 周（单人）。**排序理由**：Hub 引用是最强独立卖点先落地；校验器便宜且是后续地基紧跟；创作套件接在校验器后；Git 分发依赖前三者产出的内容，最后收口闭环。

并行不冲突：批量翻译 + LLM 配置向导（激活漏斗修复，卡牌提案遗留的实用底）按原计划推进。

### 5.1 细化后：子里程碑总表（Pal）

| 模块 | 子里程碑 | 人天合计 | 原估计 | 结论 |
|---|---|---|---|---|
| B Hub 引用 | 5（B1-B5，§2.11） | 6.5d | 5-7d | 符合 |
| C 校验器地基 | 4（C1-C4，§3.8） | 4.5d | 2-3d | 略超——含前端徽章与 pack 集成，差额来自把"打包强制校验"收进本模块 |
| C 创作套件 | 6（C5-C10，§3.13） | 7.5d | 4-6d | 略超上限——C10 结构化编辑是卡牌提案「实用底」规格的收编（修订 R2-b），属规格缺口回填而非膨胀 |
| A Git 分发 | 5（A1-A5，§1.12） | 6d | 5-7d | 符合 |
| 合计（不含联调缓冲） | 20 | 24.5d | 21-28d | 区间内，缓冲由 ~20% 收窄至 ~13%（C10 收编所致，可接受；若 W5 全链路走查暴露问题再议） |

**执行顺序锁定（boss 拍板）**：B（Hub 引用）→ C 地基（校验器）→ C（创作套件）→ A（Git 分发）。
补充：C1-C4 与 C5-C10 文件域不同（validate.rs vs authoring.rs），人手富余时可部分并行。

### 5.2 发布节奏（v0.2.0，W1–W5）

| 周 | 交付 | 状态（2026-08-05 核对） |
|---|---|---|
| W1 | 模块 B 前半：tools 注册表迁移（B1）+ 链接层与台账（B2/B3） | ✅ 完成 |
| W2 | 模块 B 后半：聚合扫描（B4）+ Hub 页接线（B5）；校验器骨架（C1/C2） | ✅ 完成（B4/B5/C1/C2） |
| W3 | 校验器收尾（C3/C4）+ 创作套件后端（C5/C6） | ✅ C3-C6 全部代码+测试完成（mock 验收过），真机部分随 app 重启 |
| W4 | 创作 AI 链路（C7-C9）+ 结构化编辑（C10，修订 R2-b）；Git 分发（A1-A3） | 🔶 C7-C10 全部代码+测试完成（mock 验收过，真机随 app 重启）；A1-A3 代码完成待真机验收 |
| W5（缓冲） | Git 分发收尾（A4/A5）+ 全链路走查：创作→校验→引用→发布→他人导入 | 🔶 部分：A4/A5 代码完成待真机验收、全链路走查未开始 |

**v0.2 验收场景（一句话）**：用户在 App 里创作一个 skill，校验通过，引用进自己的 Claude Code 与 Codex CLI，打包发布到自己的 GitHub 仓库；朋友粘贴仓库 URL，导入、安装、引用进自己的工具——全程无人工运维介入。

---

## 6. 风险与边界

| # | 风险 | 对策 |
|---|---|---|
| R1 | Windows junction 遇杀软/OneDrive 重定向路径异常 | 提供「复制模式」降级；解除引用只删链接不碰源文件（写死） |
| R2 | 用户无系统 git | 明确检测 + 引导，发布功能优雅降级为"导出文件自行上传" |
| R3 | Claude hooks 调用统计可行性未验证 | P2 先实测事件形态再立项，不提前承诺 |
| R4 | Cursor 等工具 skills 目录约定变动 | 注册表数据驱动，改 JSON 即修，不硬编码 |
| R5 | 各生态 frontmatter 规范继续漂移 | 校验器规则表做成配置化数据，随版本更新；白名单按生态分治：CX 基线 = 官方 quick_validate.py 五字段，CL = 基线 + user-invocable/disable-model-invocation（修订 R2-d），各家新增字段只需改规则表数据 |
| R6 | 仓库导入恶意包 | 复用 PLAN-05 zip 防御（entry 数/大小/深度封顶）+ sha256 自验 |

**Pal 细化阶段增量补充（R7–R16）**：

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R7 | canonicalize 穿透链接导致的既有静默折叠，聚合改造可能改变存量用户的卡片数/代表选取 | 用户感知"技能变少/变了" | B4 里程碑专项回归：改造前后对同一真实目录快照对比卡片集合；代表翻转走译文迁移提示（§2.7） |
| R8 | junction 目标落在 OneDrive 托管目录（桌面/文档重定向）| 链接被同步引擎干扰或还原 | hub_link_skill 预检目标路径是否含 OneDrive 特征路径段 → 警告后放行（不阻断，用户自担；R1 的具体化） |
| R9 | 杀毒软件拦截 reparse point 创建 | 建链失败 | 失败自动降级 copy 并给出双行文案（§2.4 决策表兜底列） |
| R10 | git stderr 关键词匹配误判（非英文环境/新版本文案变化）| 错误分类失准 | 分类只影响提示文案与重试策略，不影响正确性；兜底分支透传原文（§1.6） |
| R11 | 用户仓库工作区脏/有子模块/LFS | 发布/导入行为不可预期 | 脏工作区直接拒绝（§1.7）；LFS 仓库靠 500MB 闸 + 浅克隆兜底，超限报人话（§1.8） |
| R12 | index.json 被用户手工编辑成非标格式 | 发布合并失败 | 解析失败即中止且零改动（§1.7 步骤 3），绝不覆盖 |
| R13 | serde_yaml-ng 维护再中断 | 依赖告警 | noyalib compat feature 零调用点切换路径已预留（§3.4）；cargo audit 进 CI |
| R14 | AI 生成内容绕过校验直接落盘 | 脏技能进库 | skill_commit_draft 强制 strict 校验后才算成功（§3.11） |
| R15 | 多机发布竞争（同一用户两台机器发同一仓库）| push 冲突频率上升 | rebase 重试一次已覆盖常规场景；持续冲突提示用户收敛发布机 |
| R16 | authored 技能被引用到工具后，用户在工具侧直接编辑 | 副本分叉（junction 无此问题，copy 有） | copy 类链接在详情页标注"副本模式：工具侧编辑不会同步回源"（§2.5 台账 kind 字段支撑） |

---

## 7. 横切实现细节（Pal 细化）

### 7.1 配置 schema 增量（config.rs）

```jsonc
{
  "scan_paths": […],              // 只读兼容一版：加载时迁移进 tools，写回时丢弃（§2.6）
  "tools": [ ToolEntry ],         // §2.6 结构；内置注册表 + 迁移项 + 用户自定义
  "llm": { … },                   // 不变
  "publish_repo": {               // 模块 A 新增，全字段可选
    "local_path": "",             // 本地仓库路径（用户自选，不强置数据目录）
    "remote_url": "",
    "author_note": ""             // commit 附言模板，可空
  }
}
```

迁移函数 `migrate_v01_config()` 在 load_config 内执行（幂等：检测 `tools` 已存在即跳过），与 PLAN-05 的翻译目录迁移同模式。

### 7.2 存储位置（`Roaming\Skills Shark\` 增量）

| 新增 | 用途 | 生命周期 |
|---|---|---|
| `links.json` | 链接台账（§2.5） | 持久；启动对账 |
| `authored/` | 创作技能管理库（§3.9） | 持久；删除走 app 自有源逻辑 |
| `tmp/` | git clone 暂存、index.json 备份、pack temp | **启动即清**（§1.8），任何持久数据不得放此 |

`translations/`、`imported/`、`packs/`、`builtin/` 语义不变。

### 7.3 全部新命令汇总（v0.2 新增 19 个 + 改造 2 个）

| 模块 | 命令 |
|---|---|
| B（8） | `hub_list_tools` `hub_add_tool` `hub_update_tool` `hub_remove_tool` `hub_link_skill` `hub_unlink` `hub_convert_to_copy` `hub_links_status` |
| C 地基（1） | `skill_validate` |
| C 创作（5） | `skill_new` `skill_commit_draft` `skill_write_file` `skill_edit_frontmatter`（§3.14，修订 R2-b） `openai_yaml_generate` |
| A（5） | `git_status` `repo_setup` `publish_pack` `repo_browse` `repo_import_commit` |
| 改造（2） | `scan_skills` 返回聚合结构（§2.7，前端字段级兼容）；`create_skill_pack` 增 `force` 参数（§3.7） |

async 标注：`publish_pack` `repo_browse` `repo_import_commit` 为 async command（tokio::process），其余同步。全部新命令在 `lib.rs` 注册清单 + `api.ts` 同步封装（现有惯例）。

### 7.4 依赖清单增量（Cargo.toml）

| crate | 用途 | 备注 |
|---|---|---|
| `junction` | Windows junction | API 面小（create/delete/get_target/exists 四函数），docs.rs 确认活跃 |
| `serde_yaml-ng` | frontmatter/openai.yaml 解析 | §3.4 选型决定 |
| tokio `process` feature | async git 命令 | tauri 2 自带 tokio，确认 feature 开启即可，预期不新增依赖 |

前端：无新框架依赖（Radix/既有组件足够）。

### 7.5 遗留修改处置决定（Tip.tsx / AGENTS.md）

**决定：单独提交收编，不混入 v0.2 功能提交。** 开工前在 `v0.2.0` 分支先落两笔：
1. `fix(ui): 技能卡说明改用 Portal 渲染修复溢出截断`（Tip.tsx——独立的 UI 修复，与枢纽化零耦合，bisect 友好）；
2. `docs: v0.2 枢纽化方向立项记录`（AGENTS.md + 本文档）。

理由：遗留改动已核阅（git diff 确认是完整自洽的 Radix Portal 重写）；混入功能提交会在回滚/审查时互相牵连。

### 7.6 导航结构插槽（修订 R2-c：IA 留白的实现约束）

Hub 页与创作入口的信息架构（新 Tab？顶栏入口？）由 Paw 交互稿覆盖，本文档**不预设**。实现约束（B5/C9 接线时必须遵守）：

- 导航项一律**数据驱动**：视图注册表（id + 标题 + 渲染组件 + 排序权重），不硬编码 Tab 数量与顺序；
- TabNav/顶栏组件只消费注册表，不感知具体业务视图——交互稿定稿后改注册表数据即接入，**不重写导航组件**；
- Hub 页与创作页作为普通视图注册，入口位置（Tab / 顶栏按钮 / 详情页内）对视图实现透明。

### 7.7 mock 数据管理约定（2026-08-05，boss 指定）

mock 数据前后端**分治、各自单目录收口**，禁止散落在组件/hooks/测试内联之外的任何位置：

- **前端**：`frontend/src/mock/`（index.ts 统一出口；按域拆分 skills/packs/tools/links/translations/shelf/validation；`?mock=1` 开关在 mode.ts）。新增 mock 数据一律落此目录；
- **后端**：`frontend/src-tauri/mock/`（样例技能 + 官方原件快照 + README 登记预期行为；测试与验收只读不写）；
- 两目录**互不引用**；真实用户数据（`Roaming\Skills Shark`）永不进 mock 目录。

---

## 8. 拍板记录（2026-08-04，boss）

| # | 议题 | 结论 |
|---|---|---|
| B1 | 枢纽化方向立项 | ✅ 立项，v0.2 主线；卡牌趣味化本周期不做 |
| B2 | Python 内置 | ✅ 不内置，Rust 原生实现（boss："rust 目前足够强大"）；重启条件见 §3.3 |
| B3 | 排序 | ✅ Hub 引用 → 校验器 → 创作套件 → Git 分发 |
| B4 | 使用统计范围 | ⏸️ **待定**，需更深入讨论分析；§2.3 分层方案作为讨论底稿，暂不按任何一档开工；本期实现边界锁死为 §2.9（仅安装广度展示） |
| B5（2026-08-05 补记） | mock 数据管理 | ✅ 前后端分治单目录收口（§7.7）：前端 `src/mock/`、后端 `src-tauri/mock/` |
| B6（2026-08-05 补记） | 孤儿目录 `AppData\Skills Shark` | ✅ boss 自行删除，app 侧不做合并/迁移（3a2e5f3 已移除孤儿机制）；该项任务清单标记完成 |
| B5 | 开发分支 | ✅ `v0.2.0`，已从 main 切出 |

**分工**：Pal 在本文档基础上补充详细技术方案（各模块实现细节、命令清单、数据模型）→ ✅ 已完成（本版本，2026-08-04）；Paw 出创作向导交互稿 + AI 生成 prompt 初稿（插槽见 §3.11）+ 校验文案。

---

## 9. 修订记录

**R2（2026-08-04）——按 Paw 全文评审（797 行全审）修订四条，评审结论「可以开工」**：

| # | 评审意见 | 修订动作 |
|---|---|---|
| R2-a | §3.12 openai.yaml emitter 示例偏离官方 schema（虚构顶层 `branding:` 键与 `icon: "file-pdf"` 值） | 已对照官方 references/openai_yaml.md 逐字核实并修正：§3.12 示例字段全部归入 `interface:` 下，icon_small/icon_large 为 assets 相对路径；新增硬约束「默认只产出三个文案字段，可选字段仅在用户明确提供时写入」；同步修正 §3.1、§3.10 `openai_yaml_generate` 签名 |
| R2-b | 结构化编辑硬规格（frontmatter 表单化 + YAML round-trip 保留未知字段）失去落点 | 新增 C10 里程碑与 §3.14 规格节（含 `skill_edit_frontmatter` 命令、行级外科手术策略、字节级 diff 验收标准）；§3.2/§7.3 交叉引用同步；§5.1/§5.2 排期与总人天更新（23d→24.5d，仍在 21-28d 区间） |
| R2-c | Hub 页/创作入口 IA 留白，勿硬编码 TabNav | 新增 §7.6 导航结构插槽约束（视图注册表数据驱动）；B5/C9 验收标准加注 |
| R2-d | §3.5 FM 类型检查与 CL 白名单自相矛盾（user-invocable/disable-model-invocation 是 Claude Code 合法字段） | CL 白名单显式收录两字段（§3.1/§3.5）；CX 白名单维持 Codex 官方五字段基线（报未知字段为正确行为，矩阵分流）；R5 风险条目同步修正 |
| R2-e | C2 落地时三处规格与官方原件/生态实况冲突（Boss 2026-08-05 批准） | ① CX-04 官方原件 `short_description` 实测 24 字符（"Create or update a skill"），强卡 25 下限会打掉官方原件——豁免下限、仅保留 ≤64；② CX-01/CX-03 闸控于 `agents/` 目录存在（Codex 生态标志），纯 Claude 技能不再报 openai.yaml 噪音；③ CX-03「缺」解释为 openai.yaml 缺失而非 default_prompt 字段缺失（官方原件无该字段，强制必现会打架）。§3.5 表格已同步 |

另：§7.5 遗留修改处置（Tip.tsx 单独提交）获 Paw 确认同意，按既定节奏执行。依赖实测结论（serde_yaml-ng / junction 真实存在、API 面与选型描述一致）已核阅，维持 §3.4/§2.4 选型不变。

---

*本文档为提案留档。拍板后在 AGENTS.md 标注方向转向，卡牌化提案转"冷藏，可复活"状态。*
