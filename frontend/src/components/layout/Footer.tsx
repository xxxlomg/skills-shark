import { Github, GitFork } from "lucide-react";

/** 页脚（PLAN-09 P6）：产品名 + 双仓库链接 + 作者署名 */
function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 transition-colors hover:text-primary"
    >
      {children}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-4">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">SkillShark</span>
            {" · "}
            <FooterLink href="https://qwenpaw.agentscope.io/">
              Powered by QwenPaw
            </FooterLink>
          </p>
          <p className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <FooterLink href="https://github.com/xxxlomg">
              <Github className="h-3.5 w-3.5" />
              GitHub
            </FooterLink>
            <FooterLink href="https://gitee.com/xxxlomg">
              <GitFork className="h-3.5 w-3.5" />
              Gitee
            </FooterLink>
            <span className="text-text-tertiary">© 2026 xxxlomg</span>
          </p>
        </div>
      </div>
    </footer>
  );
}