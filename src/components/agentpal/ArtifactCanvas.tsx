"use client";

import { useState } from "react";
import {
  Code2,
  Eye,
  FileCode,
  FileType2,
 Boxes,
  X,
  Maximize2,
} from "lucide-react";
import { useStore, type Msg } from "@/lib/studio/store";
import {
  parseSegments,
  buildHtmlSrcDoc,
  type Artifact,
  type ArtifactKind,
} from "@/lib/studio/artifacts";
import Markdown from "./Markdown";

const KIND_META: Record<ArtifactKind, { label: string; icon: typeof Code2 }> = {
  svg: { label: "SVG", icon: Boxes },
  html: { label: "HTML", icon: FileCode },
  markdown: { label: "Markdown", icon: FileType2 },
  code: { label: "Code", icon: Code2 },
};

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
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-white/10"
      style={{ color: "var(--muted)" }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "html") {
    return (
      <iframe
        title={artifact.title || "artifact"}
        className="artifact-frame"
        sandbox=""
        srcDoc={buildHtmlSrcDoc(artifact.code)}
      />
    );
  }
  if (artifact.kind === "svg") {
    const doc = `<!doctype html><html><head><meta charset="utf-8"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff;padding:16px}svg{width:min(72vmin,440px);height:auto;max-width:100%;max-height:100%;display:block}</style></head><body>${artifact.code}</body></html>`;
    return (
      <iframe
        title={artifact.title || "artifact"}
        className="artifact-frame"
        sandbox=""
        srcDoc={doc}
      />
    );
  }
  if (artifact.kind === "markdown") {
    return (
      <div className="scroll-thin h-full overflow-auto bg-white p-5">
        <div className="md" style={{ color: "#0b0e1f" }}>
          <Markdown>{artifact.code}</Markdown>
        </div>
      </div>
    );
  }
  // code
  return (
    <div className="scroll-thin h-full overflow-auto p-4" style={{ background: "rgba(0,0,0,.28)" }}>
      <pre className="mono text-[12.5px] leading-relaxed" style={{ color: "var(--text)" }}>
        {artifact.code}
      </pre>
    </div>
  );
}

/** Inline card shown inside the chat for each artifact block. */
export function ArtifactCard({
  artifact,
  onOpen,
  active,
}: {
  artifact: Artifact;
  onOpen: () => void;
  active: boolean;
}) {
  const meta = KIND_META[artifact.kind];
  const Icon = meta.icon;
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5"
      style={{
        borderColor: active ? "var(--accent)" : "var(--line)",
        background: active ? "var(--glass)" : "var(--glass)",
        boxShadow: active ? "0 8px 24px -12px var(--glow)" : "none",
      }}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
        style={{ background: "linear-gradient(120deg, var(--accent), var(--accent2))" }}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
          {artifact.title || `${meta.label} artifact`}
        </span>
        <span className="mono text-[11px]" style={{ color: "var(--muted)" }}>
          {meta.label}
          {artifact.lang ? ` · ${artifact.lang}` : ""}
          {" · open in canvas"}
        </span>
      </span>
      <Maximize2 size={15} style={{ color: "var(--muted)" }} />
    </button>
  );
}

export default function ArtifactCanvas() {
  const {
    activeConversationId,
    conversations,
    activeArtifact,
    closeArtifact,
    openArtifact,
  } = useStore();

  const findArtifact = (): { message: Msg | null; artifact: Artifact | null } => {
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return { message: null, artifact: null };

    // explicit selection first
    if (activeArtifact && activeArtifact.conversationId === conv.id) {
      const m = conv.messages.find((x) => x.id === activeArtifact.messageId);
      if (m) {
        const arts = parseSegments(m.content)
          .filter((s) => s.type === "artifact")
          .map((s) => (s as any).artifact as Artifact);
        if (arts.length) {
          return { message: m, artifact: arts[arts.length - 1] };
        }
      }
    }

    // else: latest assistant message with an artifact
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.role !== "assistant" || m.streaming) continue;
      const arts = parseSegments(m.content)
        .filter((s) => s.type === "artifact")
        .map((s) => (s as any).artifact as Artifact);
      if (arts.length) {
        return { message: m, artifact: arts[arts.length - 1] };
      }
    }
    return { message: null, artifact: null };
  };

  const { message, artifact } = findArtifact();
  const messageId = message?.id ?? null;

  const [tab, setTab] = useState<"preview" | "code">("preview");

  if (!artifact || !message) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        style={{ color: "var(--muted)" }}
      >
        <span
          className="grid h-14 w-14 place-items-center rounded-2xl"
          style={{ background: "var(--glass)", border: "1px solid var(--line)" }}
        >
          <Code2 size={24} style={{ color: "var(--accent)" }} />
        </span>
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Artifact canvas
          </div>
          <div className="mt-1 max-w-[220px] text-xs">
            Ask Pal to build something — an SVG logo, an interactive HTML widget, a
            markdown report, or a code snippet. It appears here, live.
          </div>
        </div>
      </div>
    );
  }

  const meta = KIND_META[artifact.kind];
  const Icon = meta.icon;
  const showCode = artifact.kind !== "markdown" || true;
  const showTabs = artifact.kind === "html" || artifact.kind === "svg" || artifact.kind === "code";

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div
        className="flex items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "var(--line)", background: "var(--bg2)" }}
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white"
          style={{ background: "linear-gradient(120deg, var(--accent), var(--accent2))" }}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
            {artifact.title || `${meta.label} artifact`}
          </div>
          <div className="mono text-[10px]" style={{ color: "var(--muted)" }}>
            {meta.label}
            {artifact.lang ? ` · ${artifact.lang}` : ""}
          </div>
        </div>
        {showTabs && (
          <div
            className="flex items-center rounded-lg border p-0.5"
            style={{ borderColor: "var(--line)" }}
          >
            <button
              onClick={() => setTab("preview")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
              style={{
                background: tab === "preview" ? "var(--glass)" : "transparent",
                color: tab === "preview" ? "var(--text)" : "var(--muted)",
              }}
            >
              <Eye size={12} /> Preview
            </button>
            <button
              onClick={() => setTab("code")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
              style={{
                background: tab === "code" ? "var(--glass)" : "transparent",
                color: tab === "code" ? "var(--text)" : "var(--muted)",
              }}
            >
              <Code2 size={12} /> Code
            </button>
          </div>
        )}
        <button
          onClick={closeArtifact}
          className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10 xl:hidden"
          style={{ color: "var(--muted)" }}
          aria-label="Close canvas"
        >
          <X size={15} />
        </button>
      </div>

      {/* body */}
      <div className="relative flex-1 overflow-hidden">
        {showTabs && tab === "code" ? (
          <div className="flex h-full flex-col" style={{ background: "rgba(0,0,0,.28)" }}>
            <div className="flex items-center justify-end border-b px-2 py-1" style={{ borderColor: "var(--line)" }}>
              <CopyBtn text={artifact.code} />
            </div>
            <pre className="scroll-thin mono flex-1 overflow-auto p-4 text-[12.5px] leading-relaxed" style={{ color: "var(--text)" }}>
              {artifact.code}
            </pre>
          </div>
        ) : (
          <ArtifactPreview artifact={artifact} />
        )}
      </div>

      {/* footer hint */}
      <div
        className="flex items-center justify-between border-t px-3 py-1.5 text-[10px]"
        style={{ borderColor: "var(--line)", color: "var(--muted)", background: "var(--bg2)" }}
      >
        <span className="mono">rendered live · sandboxed</span>
        <button
          onClick={() => messageId && activeConversationId && openArtifact(activeConversationId, messageId)}
          className="mono transition-colors hover:text-[var(--text)]"
        >
          pin to view
        </button>
      </div>
    </div>
  );
}
