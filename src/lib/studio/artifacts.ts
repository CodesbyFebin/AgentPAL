// Artifact parsing for AgentPAL.
// An assistant message may embed one or more "artifact" fenced blocks:
//   ```artifact:<kind>[:lang=<lang>][:title=<title>]
//   <code>
//   ```
// kind ∈ "svg" | "html" | "markdown" | "code"
// These blocks are extracted from the markdown and rendered live in the
// artifact canvas. Non-artifact fenced code blocks stay inline as normal code.

export type ArtifactKind = "svg" | "html" | "markdown" | "code";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  lang?: string; // for code artifacts
  title?: string;
  code: string;
}

export interface TextSegment {
  type: "text";
  text: string;
}
export interface ArtifactSegment {
  type: "artifact";
  artifact: Artifact;
}
export type Segment = TextSegment | ArtifactSegment;

let artCounter = 0;
function nextId() {
  artCounter += 1;
  return `art-${Date.now().toString(36)}-${artCounter}`;
}

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/g;

/** Parse info string like `artifact:svg:lang=python:title=My Logo`. */
function parseInfo(info: string): {
  isArtifact: boolean;
  kind?: ArtifactKind;
  lang?: string;
  title?: string;
} {
  const parts = info.split(":").map((p) => p.trim()).filter(Boolean);
  if (parts[0] !== "artifact") return { isArtifact: false };
  const kind = (parts[1] as ArtifactKind) || "code";
  let lang: string | undefined;
  let title: string | undefined;
  for (const p of parts.slice(2)) {
    const [k, ...rest] = p.split("=");
    const v = rest.join("=").trim();
    if (k === "lang") lang = v;
    else if (k === "title") title = v;
  }
  // Bare language shorthand: artifact:code:python
  if (!lang && kind === "code" && parts[2] && !parts[2].includes("=")) {
    lang = parts[2];
  }
  return { isArtifact: true, kind, lang, title };
}

/** Split a message body into text + artifact segments (in order). */
export function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(content)) !== null) {
    const info = m[1] || "";
    const code = m[2] ?? "";
    const parsed = parseInfo(info);
    if (!parsed.isArtifact) continue; // leave normal code blocks in the text
    const before = content.slice(last, m.index);
    if (before.trim()) segments.push({ type: "text", text: before });
    segments.push({
      type: "artifact",
      artifact: {
        id: nextId(),
        kind: parsed.kind || "code",
        lang: parsed.lang,
        title: parsed.title,
        code: code.replace(/\n$/, ""),
      },
    });
    last = m.index + m[0].length;
  }
  const tail = content.slice(last);
  if (tail.trim()) segments.push({ type: "text", text: tail });
  if (segments.length === 0) return [{ type: "text", text: content }];
  return segments;
}

/** Strip artifact fences from a message, leaving a clean text body. */
export function stripArtifacts(content: string): string {
  return content.replace(FENCE_RE, (full, info, _code) => {
    if (parseInfo(info || "").isArtifact) return "";
    return full;
  });
}

/** Return the most recent artifact in a message body (for the canvas), if any. */
export function latestArtifact(content: string): Artifact | null {
  const segs = parseSegments(content);
  let last: Artifact | null = null;
  for (const s of segs) if (s.type === "artifact") last = s.artifact;
  return last;
}

/** All artifacts in a message body. */
export function allArtifacts(content: string): Artifact[] {
  return parseSegments(content)
    .filter((s): s is ArtifactSegment => s.type === "artifact")
    .map((s) => s.artifact);
}

/** Build the srcdoc for an HTML artifact (sandboxed iframe content). */
export function buildHtmlSrcDoc(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  html,body{margin:0;padding:16px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0b0e1f;background:#fff}
  *{box-sizing:border-box}
</style></head>
<body>${code}</body></html>`;
}
