import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
    const examples = [
      "A CRM for freelancers that handles invoicing",
      "A tool that turns meetings into tasks",
      "An app to schedule social posts across platforms",
      "A tool for recording and editing short videos",
    ];
    setQuery(examples[exampleIndex % examples.length]);
    setExampleIndex((value) => value + 1);
    setError("");
    input.current?.focus();
  }
  function submit() {
    if (query.trim().length < 2) {
      setError("Give us a little more to work with. At least two characters.");
      return;
    }
    if (query.length > 500) {
      setError("Keep your idea to 500 characters. A pitch, not a pitch deck.");
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
        <span className="search-shortcut" aria-hidden="true">
          <kbd>/</kbd> to focus
        </span>
      </div>
      <textarea
        ref={input}
        id="idea"
        name="q"
        rows={compact ? 2 : 3}
        placeholder="An app that turns meetings into tasks..."
        value={query}
        maxLength={500}
        onChange={(e) => {
          setQuery(e.target.value);
          setError("");
        }}
        aria-invalid={!!error}
        aria-describedby="search-help search-error"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
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
