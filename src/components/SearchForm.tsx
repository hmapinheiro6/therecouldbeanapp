import { useState } from "react";
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
      <label htmlFor="idea" className="search-label">
        Describe your app idea
      </label>
      <textarea
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
