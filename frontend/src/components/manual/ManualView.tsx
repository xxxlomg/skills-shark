import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";

/**
 * 使用手册（PLAN-09 P7）：Markdown 渲染，随版本维护。
 * v0.2.0 首版：快速上手 + 常见问题（含 P1 配置后仍提示 QA）+ 设置项说明。
 */
const MANUAL_MD = `
# SkillShark 使用手册

> 版本 v0.2.0 · 随版本维护，发布时同步修订

## 快速上手

### 1. 首次配置翻译

1. 点击右上角 **设置** →「LLM 翻译」分区；
2. 填入 API Key（仅保存在本机配置文件，不会上传任何外部服务）；
3. 填好 Base URL 与模型名（默认兼容常见 OpenAI 风格接口）；
4. 点 **测试连接** 校验通过后，**务必点底部「保存配置」**——测试只校验、不生效；
5. 回到技能详情页，点 **翻译** 即可生成中文译文。

### 2. 扫描技能

- 顶部 **扫描** 按钮（或 Ctrl/Cmd + S）重新扫描各工具的技能目录；
- 技能库按工具分组展示，卡片/列表可切换；
- 源目录中已删除的技能会自动标记，不会误删对应译文。

### 3. 翻译与维护

- 详情页点「翻译」生成双语译文；再点一次可重新翻译；
- 译文随源文件 hash 联动：源改了会提示「译文失配」，重新翻译即可；
- 已翻译技能在列表/合集里带「已翻译」徽标。

### 4. 创作技能

- 「创作」页提供工作台：填写元信息、正文，右侧实时预览；
- 支持用模板起步，保存后立即进入技能库。

### 5. Hub 引用

- 在技能库或详情页点「新建引用」，把技能 **链接** 或 **复制** 到其他 AI 工具的 skills 目录；
- Hub 台账按落点工具分组，卡片上可直接看到「去了哪个工具」；
- 删除引用、转副本、重建等操作在台账内完成。

### 6. Pack 打包与发布

- Packs 页「新建 Pack」：勾选技能（支持三层树 + 仅已翻译筛选），填名称/版本/作者；
- 已翻译技能会随包携带译文，导入方安装后立即可看中文；
- 可导出 .skillpack 文件分享，或配置「技能仓库」后一键发布。

## 常见问题

**Q：配置了 API Key 且测试连接通过，点翻译仍提示「未配置」？**

A：请确认是否点了设置底部的「保存配置」。测试连接只校验连通性，未保存则翻译侧
读不到 Key。保存后即可正常使用（v0.2.0 已修复此前的状态缓存问题）。

**Q：Hub 建了引用后，源技能库里的技能不见了？**

A：v0.2.0 已修复：引用落点（junction）不会再抢占源技能的代表位，源技能库始终保留。

**Q：下载/导入的技能文件存到哪里？**

A：默认在系统数据目录（Windows 为 %APPDATA%\\Skills Shark\\imported）。
可在「设置 → 工具 → 下载/导入路径」改为自定义目录。

**Q：译文会不会弄坏原文件？**

A：不会。译文单独存放在 translations 目录，原 SKILL.md 始终保持原样。

## 设置项说明

| 设置 | 位置 | 说明 |
|---|---|---|
| LLM 翻译 | 设置 → LLM | API Key / Base URL / 模型名；测试连接仅校验 |
| 下载/导入路径 | 设置 → 工具 | URL 下载、Pack 安装、zip/目录导入的落点 |
| 工具管理 | 设置 → 工具 | 启停内置工具、增删自定义工具及扫描路径 |
| 技能仓库 | 设置 → 技能仓库 | Pack 发布用：本地仓库路径 + 远端 URL |
`;

export function ManualView() {
  const content = useMemo(() => MANUAL_MD, []);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-primary" />
        <h1 className="font-display text-lg font-bold">使用手册</h1>
      </div>
      <div className="glass-card px-6 py-5">
        <div className="max-w-[760px]">
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </div>
  );
}