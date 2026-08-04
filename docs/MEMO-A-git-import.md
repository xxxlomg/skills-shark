# MEMO-A — 模块 A（Git 仓库导入）风险清单

> 状态：风险评审（Pal，2026-08-05）· 针对 PLAN-06 §1.2–§1.8、§2.4，模块 A 当前 0% 未动工
> 依据：PLAN-06 原文 + 现有代码逐文件核对（`lib.rs` 模块表 / `import.rs` / `pack.rs` / `config.rs` / `hub.rs` / `validate.rs` / `commands.rs` / Packs 与 Hub 前端组件）
> 范围：导入侧为主（§1.4 / §1.8 / §1.9）；发布侧（§1.3 / §1.7）只在共用 `git.rs` 封装处涉及。

---

## 1. 问题本质

**本质：给应用增加第一条"由 URL 主动拉取任意远端仓库内容进本地"的通道，且内容最终汇入既有 pack 管线。**

zip 导入是"用户先把文件拿到手上"，风险边界在文件选择框；git 导入把"取文件"这一步也交给了应用——URL 变成输入面，远端仓库的布局、体积、凭据要求、存活性全部成为应用要处理的变量。而下游（`import_pack` 的版本闸 + sha256 自验）是成熟的，所以**模块 A 的全部风险集中在"clone 到落进 import_pack 之前"这段新路上**。

关键设计事实（PLAN-06 §1.10 已定，代码核对确认）：仓库导入 = clone 后逐包 `pack::import_pack`，**零新增解析代码**；导入结果只进 Packs 库，「安装」才落 `imported/`（PLAN-05 D3）。这意味着模块 A 不产生新的扫描源、不直接碰 tools 注册表——集成面比看起来小，但幂等性与溯源缺口是真实的（见 §3.3）。

## 2. 关键约束（PLAN-06 原文 × 代码现状对账）

| 约束 | 出处 | 代码现状核对 |
|---|---|---|
| shell out 系统 git，凭据完全走用户 git 环境，App 不碰凭据 | §1.3 / §1.6 | `lib.rs` 尚无 `git.rs`；唯一 git 调用点是 `import.rs::preview_via_clone`——**同步** `std::process::Command`、无超时、无 `GIT_TERMINAL_PROMPT=0`、无 `--single-branch`。它是先例，也是待收编的技术债（§4 步骤 1） |
| async tauri command + `tokio::process`，120s 软超时 + 可取消 | §1.6 | 现有 `preview_url_import` 是**同步**命令（`commands.rs:391`），clone 期间阻塞。模块 A 新命令必须 async，不能沿用旧姿势 |
| clone 目标 `<data_dir>/tmp/repo-<随机>`，启动即清三重保险 | §1.8 | 地基已就位：`config::cleanup_tmp_dir()` 已在 `lib.rs` setup 注册（PLAN-06 §7.2）。`import.rs` 现有 clone 用的是系统 TEMP 的 `tempfile`，不在清理契约内——两处临时目录策略并存，模块 A 应统一到 data_dir/tmp |
| pending token 两步式（browse → commit） | §1.8 | `import.rs` 已有 `PENDING: LazyLock<Mutex<HashMap>>` 注册表（zip/url 共用），模块 A 复用同一模式即可，token 绑定 clone 目录 |
| 无 git 降级走 archive 通道 | §1.9 | `import.rs::repo_archive_urls` 只认 **github.com / gitee.com**、只试 **main / master** 两个分支。这是现有能力边界，模块 A 的降级路径直接继承这两个盲区（§3.1） |
| 浅克隆控体积，clone 后 ≤500MB 闸 | §1.8 | 现无目录体积统计工具；`import.rs` 的 `extract_safely` 只有 zip 侧上限（条目数/单条目 50MB/总量），目录树体积闸是新增代码 |
| 500MB 以内 + index.json 缺省降级扫 `*.skillpack` | §1.2 | 扫描深度约定应对齐 `scanner.rs` 的 `MAX_SCAN_DEPTH=3`；现成 `pack::detect_pack` 可逐包探测 |
| tools 注册表语义 | §2.6 + config.rs | `imported` 是 `app_owned=true, linkable=false` 的应用自有源（`config.rs:416`）。模块 A 不新增扫描源：货架内容经 `pack_install` → `imported/<stem>` 才进扫描（`ensure_imported_scan_path`），链路已通 |

---

## 3. 风险清单

### 3.1 技术选型：tokio::process shell-out vs libgit2(git2)

PLAN-06 §1.6 已拍板 shell-out，复核维持原结论——但要把**成立条件**写清楚，这些条件一旦失守就是事故：

**维持 shell-out 的理由（对 git2 的硬优势）**

| 维度 | shell-out | git2 (libgit2) |
|---|---|---|
| 体积 / 依赖 | 0 新增依赖；NSIS 包体不变 | 背 libgit2 + openssl/libssh2 原生依赖，交叉编译复杂度上升 |
| 凭据 | 天然继承 credential manager / ssh-agent / `~/.ssh/config` / 代理 / insteadOf | 凭据回调全部自接；libssh2 默认不读用户 ssh 配置，Windows 尤甚 |
| 行为一致性 | 用户命令行能做的 App 都能做 | 换行 / LFS / hook 行为与本地 git 有微妙差异 |

**shell-out 侧的真实风险（都要在 `git.rs` 封装层一次性解决）**

1. **Windows GUI 进程的 PATH 可见性**：Tauri 应用从开始菜单/安装器启动时，继承的是注册表 user+system PATH，不含 shell profile 追加（posh-git、scoop shims 若写入 profile 而非环境变量）。`git --version` 探测失败 ≠ 用户没装 git。`detect()` 报错文案必须区分"未检测到 git"与"已装但 App 看不到"，引导语给"在终端里 `where git` 核对"的自查路径，否则用户会对着一个明明装了 git 的机器收到"请安装 git"（§1.7/§1.9 的引导要求在这里才真正落地）。
2. **`CREATE_NO_WINDOW`**：tokio/std 拉起 `git.exe` 在 Windows 上会闪控制台窗口。必须在 Windows 平台给 `Command` 固定注入 `creation_flags(CREATE_NO_WINDOW)`——这是每个调用点都会忘、忘一次就被用户看见一次的问题，只能靠封装层强制。
3. **取消/超时 = 杀进程树，不是杀 git**：`git clone` 会派生 `git-remote-https` 等子进程；只 kill 父进程会留下孤儿继续跑完 clone。Windows 上可靠的杀法是 `taskkill /T /F` 或 job object。120s 软超时若只杀父进程，"取消"按钮就是假的。
4. **stderr 关键词分类依赖英文报错**：`LC_ALL=C` 在 Windows 的 git-for-windows 上不是有效开关（其消息默认英文，靠的是构建而非环境变量）。分类（AuthFailed / NonFastForward）匹配不上时必须落 `Other(stderr 截断透传)`，不得猜——PLAN-06 §1.6 已有此原则，实现时别省略。
5. **探测缓存**：`git --version` 在 Windows 上可能经过 shim，首次调用数百毫秒；`git_status` 是设置页/发布按钮/导入入口三处的使能依据，结果应在会话内缓存，别每次渲染都 fork 进程。

**结论**：选型不翻案；风险全部收敛到 `git.rs` 封装层的五条纪律（探测文案、no-window、树杀、分类兜底、缓存）。libgit2 的唯一长期优势是"无 git 环境也能 clone"，但 §1.9 已用 archive 通道覆盖公开仓库场景，私有仓库无 git 本来就无解——不值得为它背原生依赖。

### 3.2 浅克隆 / 分支选择 / 子目录技能仓库

1. **`--depth 1 --single-branch` 只拿默认分支**：货架在 `release`/`shelf` 等非默认分支上的仓库，v1 直接看不到 index.json → 走降级扫描也大概率空手。**决策点**：v1 是否接受 URL 携带分支（`url#branch` 或独立输入框）？建议 v1 不支持但在报错文案中说明"货架必须在默认分支"，把需求留到真实反馈出现。
2. **archive 降级通道的同源盲区**：无 git 时走 `repo_archive_urls`，只认 github/gitee + main/master（§3.1 表下方约束行）。ssh URL（`git@…`）无 archive 可言，无 git + ssh = 硬失败——文案必须明确"ssh 协议需要本机 git"，不能笼统报"导入失败"。
3. **子目录技能仓库（monorepo）**：货架布局约定 index.json 在仓库根（§1.2），但真实世界的仓库更可能是 `repo/skills/packs/*.skillpack` 甚至 `repo/projects/foo/skills/…`。index.json 缺失触发降级扫描时：
   - 扫描必须**跳过 `.git`**（里面是海量对象文件，走进去就是性能事故）；
   - 深度上限对齐 `MAX_SCAN_DEPTH=3`，超限报"未找到 .skillpack，请确认仓库布局"而不是递归全仓库；
   - `--depth 1` 不影响目录深度，monorepo 依然可以很深——扫描是读盘不是下载，体积闸（500MB）管下载，深度闸管扫描，两者都要有。
4. **LFS 仓库**：`--depth 1` clone 不触发 LFS smudge 时，`.skillpack` 落地是指针文本 → `detect_pack` 报"pack.json 解析失败"，用户看到的是天书。降级扫描命中文件但探测失败时，应读取文件头判别 LFS 指针（`version https://git-lfs.github.com/spec/v1`）并给出人话："该仓库用 Git LFS 存包，暂不支持"。
5. **clone 后体积闸的时机**：500MB 检查发生在 clone **完成之后**——磁盘峰值已经发生。对超大仓库这是"先污染后检查"。缓解：clone 加 `--filter=blob:none`？不行，会导致后续按需拉取、行为复杂化。接受现状，但在文案上说明，且 clone 目录在 data_dir/tmp 内、启动即清，最坏残留可控（§1.8 已论证）。

### 3.3 集成盲区

1. **clone 目录落点与 tools 注册表的关系**——已闭环，无新风险：clone 目录在 `data_dir/tmp`（非扫描目标），内容经 `pack_import` 进 `packs/`（非扫描目标），只有用户「安装」后经 `pack_install` + `ensure_imported_scan_path` 进 `imported` 才被扫描。模块 A **不需要也不应该**往 tools 注册表加任何条目。唯一注意：若有人顺手把 clone 目录放进 data_dir 其他位置（而非 tmp/），会被启动清理误伤或反过来永不清理——`<data_dir>/tmp/repo-*` 路径格式应作为 `git.rs` 内部不变量，不给调用方自选权。
2. **重复导入幂等性（最大语义缺口）**：`import_pack` 的铁律是"永不覆盖、冲突改名"（`alloc_pack_dir` 加 `-2` 后缀）。同一货架导入两次 → Packs 库出现两套同内容包；安装两次 → `imported/<名>` 与 `<名>-2` 双份。**这不是 bug，但货架场景让它从边缘行为变成主流路径**（用户刷新货架就是重复导入）。当前无任何字段记录"这个 pack 来自哪个仓库"——`pack.json` 无溯源字段，`.import.json` 只记在安装侧。
   **建议**（决策点，不阻塞 v1）：`repo_import_commit` 在导入成功后把溯源写入 pack 目录的旁路文件（如 `packs/<id>/.repo.json`：repo URL + index.json 声明的 sha256 + 导入时间），不动 `pack.json`（format_version=1 的 schema 红线不碰，`serde` 默认忽略未知字段也意味着加了不炸）。有了它，二次导入才能做"已存在且一致 → 跳过；sha256 变化 → 提示有新版本"的幂等体验。v1 最低限度：导入前用 index.json 的 `packs[].sha256` 与本地已有包的旁路记录比对，UI 上标出"已导入"，把选择权给用户。
3. **与 Hub 账本（`links.json`）的交互**——隔了一层，直接交互为零，但有一条跨模块因果链要写进文档：货架包 → 安装 → `imported/` 技能 → 被 `hub_link_skill` 以 junction 引用到各工具。**此后该技能的内容事实源是 `imported/<stem>/<folder>`**。推论：未来若做"货架更新"（重新导入新版包），绝不能原地更新 `imported/<stem>`——那会静默改写所有 junction 下游工具里的技能内容。更新 = 新 stem 新副本，引用留在旧版，由用户显式重新引用。v1 不做更新，此条作为边界提前声明。
4. **与校验器（`validate.rs`）的交互**：`skill_validate(path, mode)` 已可用，但 `import_pack` 链路**不跑技能规范校验**（只有 sha256 完整性）。PLAN-06 §3.7 设想校验记录随 `pack.json.metadata.validation_warnings` 传播，但当前 `PackManifest` 无该字段（模块 C 的 C4 未动工）。模块 A 的货架浏览 UI：
   - 发布者若已带校验记录 → 展示（需要 C4 先行，否则无数据）；
   - 不带 → 不在浏览期解包跑校验（成本与必要性都不成立）；导入后用户可在详情页手动触发。
   - 立场延续 PLAN-05 D9：**校验永不阻断导入**，只诊断。
5. **index.json 是网络输入，按不可信处理**：
   - `packs[].path` 必须做路径逃逸检查（拒 `..`、拒绝对路径、限仓库内）——恶意货架可以用 `../../evil` 把读取引向仓库外（clone 目录内）任意位置；
   - index.json 本体限大小（建议 1MB）+ `format_version` 闸（同 pack 惯例）+ 解析失败降级扫描而非报错（§1.2 已定）；
   - `packs[].sha256` 是发布者的**声明**，不是事实源——落盘有效性以 `import_pack` 内部自验为准；两者不符时报"货架清单与包内容不一致"，属于警告级（清单可能过期），不静默。
6. **Packs 页 ghost card 接线**：现状核对——`PacksView` 只有一张「导入 .skillpack」ghost 卡；「从 Git 仓库导入」ghost 卡目前在 **HomeView**（技能库页），接的是 `UrlImportDialog`（PLAN-04 裸技能导入，进 `imported/`）。模块 A 的货架导入是**另一个语义**（进 Packs 库），接线风险：
   - **两个"Git 导入"并存**：技能库页导裸技能、Packs 页导货架。命名必须可区分（建议 Packs 页卡文案「从技能仓库导入」或副标题「.skillpack 货架」），否则用户分不清粘贴同一个 URL 为什么两处结果不同；
   - 新对话框（RepoBrowseDialog：URL 输入 → browse → 货架勾选 → commit）与 `UrlImportDialog` 是两条独立链路，不要试图合并成一个对话框内分流——preview 阶段还不知道仓库是不是货架，分流时机在 clone 之后，太晚；
   - `CommandSearch` 的「从 Git 仓库导入…」动作当前指向技能库链路，是否追加货架动作是 IA 决策点；
   - `?mock=1` 纯前端模式需要货架 mock 数据，否则演示态点进 ghost 卡是空白。

---

## 4. 建议实现顺序（命令粒度）与每项的坑

顺序原则：先封装后命令，先后端后 UI，browse/commit 两步之间随时可停。对应 PLAN-06 §1.12 的 A1/A4/A5（A2/A3 是发布侧，不在本清单）。

| # | 交付 | 内容 | 潜在坑 |
|---|---|---|---|
| 1 | `git.rs` 封装层（模块级，非命令） | `detect()` + `async run(repo, args)` + `GitError` 分类（§1.6 枚举）；固定注入 `GIT_TERMINAL_PROMPT=0`、`CREATE_NO_WINDOW`（Windows）、120s 超时 + 进程树 kill；`import.rs::preview_via_clone` 收编改走此层 | 收编旧调用点会改动**已上线的 URL 导入**行为（从同步变异步、错误文案变化）——回归测试必须覆盖"archive 失败 → git 兜底"路径；树杀在 Windows 上用 taskkill 的实现要单测 |
| 2 | `git_status` 命令 | `() -> GitStatusInfo{installed, version}`（v1 只需这两字段，发布侧字段后补） | 探测延迟 → 会话内缓存；「装了但看不见」的文案（§3.1-1） |
| 3 | `repo_browse` 命令（async） | detect 门 → clone 到 `<data_dir>/tmp/repo-<rand>` → 500MB 闸 → index.json 解析（路径逃逸/大小/版本闸）→ 降级扫描（跳 `.git`、深度 3、LFS 判别）→ 注册 pending token 返回 `ShelfPreview` | 无 git → 自动改走 archive 通道（仅 github/gitee + main/master，文案说明局限）；ssh URL 无 git → 明确报错；token 必须绑定 clone 目录，browse 失败路径必须删目录 |
| 4 | Packs 页 ghost card + `RepoBrowseDialog` | 卡片位（空态双卡变三卡、有态插首位，与现有 importGhost 同构）；货架列表勾选 UI；进行中态 + 取消 | 两处 Git 导入的命名区分（§3.3-6）；mock 模式；clone 分钟级耗时下的进度表达（async 命令无内建进度，v1 用不定态 spinner 即可，事件推进留后手） |
| 5 | `repo_import_commit` 命令（async） | token → 逐包 `pack::import_pack`（版本闸 + sha256 全复用）→ 写 `.repo.json` 溯源（§3.3-2 建议）→ 删 clone 目录 + 注销 token | **部分失败语义**：3 个包导入 2 成 1 败 → 成功的保留、失败的列清单，不回滚（与 import_pack 的原子性粒度一致）；index.json sha256 声明与自验不符 → 警告不阻断；commit 后无论成败必须清理 clone 目录，崩溃残留交给启动清理兜底 |
| 6 | （缓做，留接口）货架更新 / 去重体验 | 基于 `.repo.json` 的"已导入/有新版"标记 | 依赖 #5 的溯源落地；原地更新 imported 的方案永久禁止（§3.3-3） |

---

## 5. 最致命的三个风险

1. **Windows GUI 进程的子进程治理**（§3.1-1/2/3）：PATH 可见性误判 + 控制台闪窗 + 杀不掉的进程树，三件事同源于"shell-out 在 Windows GUI 进程里的行为与终端里不同"。任何一条没在 `git.rs` 封装层封死，都会以"偶发、难复现、用户环境独有"的形态回来——这是模块 A 最可能产生长尾工单的地方。
2. **index.json / 仓库布局是不可信远端输入**（§3.2-4、§3.3-5）：路径逃逸、LFS 指针、超深 monorepo、体积炸弹。zip 导入时代"用户先拿到文件"的隐性信任边界被打破，而现有 `extract_safely` 的防线只覆盖 zip 侧。browse 阶段是模块 A 唯一的攻击面，所有校验必须发生在内容进入 pack 管线**之前**。
3. **重复导入的幂等性与溯源缺口**（§3.3-2）：`import_pack` 永不覆盖的语义在货架场景下把"重复导入"变成日常操作，而当前没有任何字段能回答"这个包来自哪个仓库、是哪个版本"。v1 若不落 `.repo.json` 溯源，"更新货架"这个必然到来的需求将无路可走，只能靠用户手动删包——产品层面的体验债，比技术债更难还。

---

*Pal · 2026-08-05 · 配套交付：README「Skillpack 安装与使用」章节（P0-4）*
