/**
 * 轻量 Markdown 渲染（纯前端，无第三方依赖）
 * 从原 app.js 迁移，保留所有功能
 */

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 行内 Markdown（image / code / bold / link） */
export function inlineMd(text: string): string {
  return escapeHtml(text)
    // 图片先于链接处理，避免 ![alt](url) 被链接规则截半
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      '<img src="$2" alt="$1" loading="lazy" />',
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    );
}

/** 表格渲染 */
function renderTable(rows: string[]): string {
  const cells = (r: string) =>
    r
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());

  let out = "<table>";
  rows.forEach((r, idx) => {
    // 分隔行 |---|---| 跳过
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(r) && r.includes("-")) return;
    const tag = idx === 0 ? "th" : "td";
    out +=
      "<tr>" +
      cells(r)
        .map((c) => `<${tag}>${inlineMd(c)}</${tag}>`)
        .join("") +
      "</tr>";
  });
  return out + "</table>";
}

/** 完整 Markdown → HTML */
export function renderMd(mdText: string): string {
  // 归一化行尾：CRLF/CR → LF。否则 split("\n") 后每行行尾残留 \r，
  // 使依赖 $ 锚定的标题/列表/表格/引用正则全部失效（手册 .md 为 CRLF 时整篇退化成纯段落）。
  const lines = String(mdText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const html: string[] = [];
  let i = 0;
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      html.push(listType === "ul" ? "</ul>" : "</ol>");
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^\s*```/.test(line)) {
      closeList();
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合围栏
      html.push(
        `<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // 标题
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      closeList();
      const level = hm[1].length;
      html.push(`<h${level}>${inlineMd(hm[2])}</h${level}>`);
      i++;
      continue;
    }

    // 表格行
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      html.push(renderTable(rows));
      continue;
    }

    // 无序列表
    const ulm = line.match(/^\s*[-*]\s+(.*)$/);
    // 有序列表
    const olm = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ulm || olm) {
      const type: "ul" | "ol" = ulm ? "ul" : "ol";
      if (listType !== type) {
        closeList();
        html.push(type === "ul" ? "<ul>" : "<ol>");
        listType = type;
      }
      html.push(`<li>${inlineMd(ulm ? ulm[1] : olm![1])}</li>`);
      i++;
      continue;
    }
    closeList();

    // 引用
    const qm = line.match(/^\s*>\s?(.*)$/);
    if (qm) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inlineMd(buf.join(" "))}</blockquote>`);
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 普通段落（合并连续行）
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    html.push(`<p>${inlineMd(buf.join(" "))}</p>`);
  }

  closeList();
  return html.join("\n");
}
