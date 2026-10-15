"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Citation } from "@/lib/api";

// One or more adjacent markers like "[3]", "[1, 2]" or "[1][2]" (with the
// whitespace before them), but not a real Markdown link like [text](url).
const CITE_RUN_RE = /(\s*)((?:\[\d+(?:\s*,\s*\d+)*\](?!\()\s*)+)/g;

/**
 * Rewrite the model's [n] citation markers into links to "#cite-n", so the
 * Markdown parser keeps them as nodes we can render as badges, wherever they
 * appear (inside lists, bold text, tables...).
 *
 * Models often cite the same source on every line ("... [1]" x 20), which is
 * noisy. We only show a badge when the cited source(s) change, and reset at
 * each heading, so every section still shows where it came from. The full
 * list is always in the Sources footer.
 */
export function linkifyCitations(markdown: string): string {
  let previous = "";
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}#{1,6}\s/.test(line)) previous = "";
      return line.replace(CITE_RUN_RE, (match, lead: string, run: string) => {
        const nums = [...new Set(run.match(/\d+/g) ?? [])];
        const key = nums.join(",");
        if (key === previous) return run.endsWith(" ") ? " " : ""; // drop the repeat
        previous = key;
        return `${lead}${nums.map((n) => `[${n}](#cite-${n})`).join("")}${run.endsWith(" ") ? " " : ""}`;
      });
    })
    .join("\n");
}

function CitationBadge({
  index,
  source,
  onOpen,
}: {
  index: number;
  source?: Citation;
  onOpen?: (source: Citation) => void;
}) {
  const label = source ? `${source.title}, page ${source.page}` : `Source ${index}`;
  const clickable = Boolean(source && onOpen);
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => source && onOpen?.(source)}
      title={clickable ? `Show source: ${label}` : label}
      aria-label={`Source ${index}: ${label}`}
      className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-full bg-accent-soft px-1 align-middle text-[10px] font-bold leading-none text-accent-fg ring-1 ring-accent/40 transition enabled:cursor-pointer enabled:hover:bg-accent enabled:hover:text-fg disabled:cursor-help"
    >
      {index}
    </button>
  );
}

function buildComponents(
  sources: Citation[],
  onCitationClick?: (source: Citation) => void,
): Components {
  const byIndex = new Map(sources.map((s) => [s.index, s]));
  return {
    a: ({ href, children }) => {
      if (href?.startsWith("#cite-")) {
        const index = Number(href.slice(6));
        return (
          <CitationBadge index={index} source={byIndex.get(index)} onOpen={onCitationClick} />
        );
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          {children}
        </a>
      );
    },
    p: ({ children }) => <p className="my-2.5 leading-7 first:mt-0 last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
    h1: ({ children }) => (
      <h3 className="mb-2 mt-5 text-lg font-bold first:mt-0">{children}</h3>
    ),
    h2: ({ children }) => (
      <h3 className="mb-2 mt-5 text-base font-bold first:mt-0">{children}</h3>
    ),
    h3: ({ children }) => (
      <h4 className="mb-1.5 mt-4 font-display text-sm font-bold uppercase tracking-wide text-primary-strong first:mt-0">
        {children}
      </h4>
    ),
    ul: ({ children }) => (
      <ul className="my-2.5 ml-5 list-disc space-y-1.5 marker:text-primary [&_ul]:my-1.5">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2.5 ml-5 list-decimal space-y-1.5 marker:font-semibold marker:text-primary [&_ol]:my-1.5">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-accent bg-accent-soft/40 py-1 pl-3 text-fg-soft">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    code: ({ children }) => (
      <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[0.85em] text-primary-strong">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      // Reset the inline-code styling for code inside a block.
      <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-surface-muted p-3 text-xs leading-6 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-fg">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-surface-muted">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-border-strong px-3 py-2 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
  };
}

/**
 * Renders an assistant answer. Raw HTML in the model output is ignored
 * (react-markdown's default), so a document can't inject markup into the page.
 */
export function Markdown({
  content,
  sources = [],
  onCitationClick,
}: {
  content: string;
  sources?: Citation[];
  onCitationClick?: (source: Citation) => void;
}) {
  return (
    <div className="text-[15px] text-fg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={buildComponents(sources, onCitationClick)}
      >
        {linkifyCitations(content)}
      </ReactMarkdown>
    </div>
  );
}
