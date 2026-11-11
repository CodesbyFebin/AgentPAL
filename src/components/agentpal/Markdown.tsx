"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy } from "lucide-react";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/10"
      style={{ color: "var(--muted)" }}
      aria-label="Copy code"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span>{lang || "code"}</span>
        <CopyBtn text={code} />
      </div>
      <pre className="scroll-thin">{code}</pre>
    </div>
  );
}

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        disallowedElements={["img"]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children ?? "");
            const match = /language-(\w+)/.exec(className || "");
            const isBlock = !!match || text.includes("\n");
            if (!isBlock) {
              return <code>{children}</code>;
            }
            return <CodeBlock code={text.replace(/\n$/, "")} lang={match?.[1]} />;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function SourcesList({ sources }: { sources: { url: string; name: string; snippet?: string }[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {sources.map((s, i) => (
        <a
          key={s.url + i}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors hover:bg-white/5"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          title={s.snippet || s.url}
        >
          <span
            className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[8px] font-bold text-white"
            style={{ background: "var(--accent)" }}
          >
            {i + 1}
          </span>
          <span className="truncate" style={{ color: "var(--text)" }}>
            {s.name}
          </span>
        </a>
      ))}
    </div>
  );
}

export function PlainText({ children }: { children: ReactNode }) {
  return <div className="md whitespace-pre-wrap">{children}</div>;
}
