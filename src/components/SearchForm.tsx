import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MAX_QUERY_LENGTH } from "../lib/search/limits";
import { IDEA_EXAMPLES, TypingSuggestion } from "./TypingSuggestion";
export function SearchForm({
  initial = "",
  compact = false,
}: {
  initial?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(initial),
    [error, setError] = useState("");
  const navigate = useNavigate();
  const input = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        (target instanceof Element &&
          target.closest(
            "input, textarea, select, button, a, [contenteditable], [role='textbox']",
          ))
      )
        return;
      event.preventDefault();
      input.current?.focus();
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  function tryExample() {
    setQuery(IDEA_EXAMPLES[exampleIndex % IDEA_EXAMPLES.length]);
    setExampleIndex((value) => value + 1);
    setError("");
    input.current?.focus();
  }
  function submit() {
    if (query.trim().length < 2) {
      setError("Give us a little more to work with. At least two characters.");
      return;
    }
    if (query.length > MAX_QUERY_LENGTH) {
      setError(
        `Keep your idea to ${MAX_QUERY_LENGTH} characters. A pitch, not a pitch deck.`,
      );
      return;
    }
    setError("");
    navigate("/search?q=" + encodeURIComponent(query.trim()));
  }
  return (
    <form
      className={"search-form " + (compact ? "compact" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="search-label-row">
        <label htmlFor="idea" className="search-label">
          Describe your app idea
        </label>
        <span className="search-entry-status">
          <span
            id="idea-limit"
            className={
              query.length >= MAX_QUERY_LENGTH - 20 ? "near-limit" : ""
            }
          >
            {query.length} / {MAX_QUERY_LENGTH}
            <span className="sr-only"> characters</span>
          </span>
          <span className="search-shortcut" aria-hidden="true">
            <kbd>/</kbd> to focus
          </span>
        </span>
      </div>
      <div className="idea-entry">
        {!compact && !query && <TypingSuggestion paused={focused} />}
        <textarea
          ref={input}
          id="idea"
          name="q"
          rows={2}
          placeholder={
            compact ? "An app that turns meetings into tasks…" : undefined
          }
          value={query}
          maxLength={MAX_QUERY_LENGTH}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setError("");
          }}
          aria-invalid={!!error}
          aria-describedby="search-help search-error idea-limit idea-example"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <span id="idea-example" className="sr-only">
        For example: a tool that turns meetings into tasks.
      </span>
      <div className="search-assists">
        <button type="button" onClick={tryExample}>
          ↳ Try an example
        </button>
        <button
          type="button"
          aria-expanded={tipOpen}
          aria-controls="idea-tip"
          onClick={() => setTipOpen((value) => !value)}
        >
          {tipOpen ? "− Hide search tips" : "+ What makes a good search?"}
        </button>
      </div>
      {tipOpen && (
        <div id="idea-tip" className="search-tip">
          <p>
            Start with <b>the task + who it’s for</b>. Add one must-have.
          </p>
          <p>
            Try “invoicing for freelancers with time tracking” instead of “the
            next big productivity app”.
          </p>
        </div>
      )}
      <div className="search-bottom">
        <span id="search-help">
          {compact
            ? "Edit your idea. Test your luck."
            : "Plain English. Unreasonable ambition welcome."}
          <small>Enter to search · Shift + Enter for a new line</small>
        </span>
        <button className="button primary" type="submit">
          <span aria-hidden="true">[</span> Ruin my idea{" "}
          <span aria-hidden="true">→ ]</span>
        </button>
      </div>
      <p role="alert" id="search-error" className="field-error">
        {error}
      </p>
    </form>
  );
}
