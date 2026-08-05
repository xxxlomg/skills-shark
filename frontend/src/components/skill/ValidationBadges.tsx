import { useEffect, useState } from "react";
import { Check, AlertTriangle, XCircle } from "lucide-react";
import {
  skillValidate,
  type ValidationReport,
  type ValidateVerdict,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/common/Tip";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * C3 兼容矩阵徽章（PLAN-06 §3.6/§3.8）：
 * 技能详情面板显示 claude / codex 两平台的 verdict 徽章，
 * 默认诊断模式（永不 fail——fail 只在 strict 打包闸出现）。
 * hover 显示 notes + issues 明细。
 */

// 模块级缓存：按技能目录键控。校验是磁盘 I/O，面板每次打开都重调会抖；
// 失败清键，允许下次打开重试。
const cache = new Map<string, Promise<ValidationReport>>();

function cachedValidate(dir: string): Promise<ValidationReport> {
  let p = cache.get(dir);
  if (!p) {
    p = skillValidate(dir, "diagnostic");
    p.catch(() => cache.delete(dir));
    cache.set(dir, p);
  }
  return p;
}

const VERDICT_STYLE: Record<ValidateVerdict, string> = {
  pass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  fail: "border-red-500/40 bg-red-500/10 text-red-600",
};

const VERDICT_LABEL: Record<ValidateVerdict, string> = {
  pass: "兼容",
  warn: "需注意",
  fail: "不兼容",
};

function VerdictIcon({ verdict }: { verdict: ValidateVerdict }) {
  const cls = "mr-1 h-3 w-3";
  if (verdict === "pass") return <Check className={cls} />;
  if (verdict === "warn") return <AlertTriangle className={cls} />;
  return <XCircle className={cls} />;
}

interface ValidationBadgesProps {
  /** 技能目录（skill.skill_dir）；校验以目录为单位 */
  skillDir: string;
}

export function ValidationBadges({ skillDir }: ValidationBadgesProps) {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setReport(null);
    cachedValidate(skillDir)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setState("ok");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [skillDir]);

  if (state === "loading") {
    return <Skeleton className="h-[22px] w-[170px] rounded-full" />;
  }

  // 错误降级：灰态占位，不阻断详情面板其他功能（mock 无真实路径也走这里兜底）
  if (state === "error" || !report) {
    return (
      <Badge variant="outline" className="text-[11px] opacity-60">
        校验不可用
      </Badge>
    );
  }

  const cells = [
    { platform: "Claude", cell: report.matrix.claude },
    { platform: "Codex", cell: report.matrix.codex },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {cells.map(({ platform, cell }) => {
        // 明细：notes 优先（矩阵自带的人话摘要），其次 issues 全表
        const lines: string[] = [
          ...cell.notes,
          ...report.issues
            .filter((i) => i.severity !== "info")
            .map((i) => `[${i.rule_id}] ${i.message}`),
        ];
        const badge = (
          <Badge
            variant="outline"
            className={`text-[11px] ${VERDICT_STYLE[cell.verdict]}`}
          >
            <VerdictIcon verdict={cell.verdict} />
            {platform} · {VERDICT_LABEL[cell.verdict]}
          </Badge>
        );
        if (lines.length === 0) {
          return (
            <Tip
              key={platform}
              label={`${platform}：通过全部校验规则`}
              side="bottom"
            >
              {badge}
            </Tip>
          );
        }
        return (
          <Tip
            key={platform}
            side="bottom"
            label={
              <span className="block space-y-0.5">
                <span className="block font-semibold">
                  {platform} · {VERDICT_LABEL[cell.verdict]}
                </span>
                {lines.map((l, i) => (
                  <span key={i} className="block">
                    · {l}
                  </span>
                ))}
              </span>
            }
          >
            {badge}
          </Tip>
        );
      })}
    </div>
  );
}
