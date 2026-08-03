export function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-4">
        <p className="text-center text-xs text-muted-foreground">
          SkillsShark · Powered by{" "}
          <a
            href="https://qwenpaw.agentscope.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-primary"
          >
            QwenPaw
          </a>
        </p>
      </div>
    </footer>
  );
}
