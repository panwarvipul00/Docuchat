"use client";

import { useEffect, useRef } from "react";

import { SendIcon, StopIcon } from "@/components/icons";

const MAX_LENGTH = 2000; // matches AskSerializer on the backend

/**
 * Question input: grows with its content, Enter sends, Shift+Enter adds a
 * new line. While an answer streams, the send button becomes Stop.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming = false,
  disabled = false,
  placeholder = "Ask about your documents…",
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~8 lines, then scroll inside the box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const canSend = !streaming && !disabled && value.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      className="flex items-end gap-2 rounded-2xl border border-border-strong bg-surface p-2 shadow-sm transition-colors focus-within:border-primary"
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Your question"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // isComposing: don't send while an IME (e.g. Hindi/Japanese input) is mid-word.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        className="no-focus-ring max-h-[220px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted disabled:opacity-60"
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generating"
          title="Stop generating"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fg text-surface hover:opacity-85"
        >
          <StopIcon size={14} />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send question"
          title="Send (Enter)"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40"
        >
          <SendIcon size={17} />
        </button>
      )}
    </form>
  );
}
