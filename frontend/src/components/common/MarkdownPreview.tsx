import ReactMarkdown from "react-markdown";

/**
 * Markdown 实时渲染预览（UI 反馈 2026-08-05 条目 6）。
 * 轻量样式映射，不引 typography 插件；用于创作页正文分栏/全屏预览。
 */
export function MarkdownPreview({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={className ?? ""}>
      <ReactMarkdown
        components={{
          h1: (p) => (
            <h1 className="mb-2 mt-4 text-lg font-bold text-text-primary first:mt-0">
              {p.children}
            </h1>
          ),
          h2: (p) => (
            <h2 className="mb-2 mt-3 text-base font-semibold text-text-primary first:mt-0">
              {p.children}
            </h2>
          ),
          h3: (p) => (
            <h3 className="mb-1.5 mt-2 text-sm font-semibold text-text-primary first:mt-0">
              {p.children}
            </h3>
          ),
          p: (p) => (
            <p className="my-1.5 text-[13px] leading-relaxed text-text-secondary">
              {p.children}
            </p>
          ),
          ul: (p) => (
            <ul className="my-1.5 list-disc pl-5 text-[13px] text-text-secondary">
              {p.children}
            </ul>
          ),
          ol: (p) => (
            <ol className="my-1.5 list-decimal pl-5 text-[13px] text-text-secondary">
              {p.children}
            </ol>
          ),
          li: (p) => <li className="my-0.5">{p.children}</li>,
          pre: (p) => (
            <pre className="my-2 overflow-x-auto rounded-md border border-border/40 bg-glass-1 p-2 font-mono text-[12px] text-text-secondary">
              {p.children}
            </pre>
          ),
          code: (p) => (
            <code className="rounded bg-glass-2 px-1 py-0.5 font-mono text-[12px]">
              {p.children}
            </code>
          ),
          blockquote: (p) => (
            <blockquote className="my-2 border-l-2 border-primary/50 pl-3 text-text-secondary">
              {p.children}
            </blockquote>
          ),
          a: (p) => (
            <a className="text-primary underline" href={p.href} target="_blank" rel="noreferrer">
              {p.children}
            </a>
          ),
          hr: () => <hr className="my-3 border-border/40" />,
          strong: (p) => (
            <strong className="font-semibold text-text-primary">{p.children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
