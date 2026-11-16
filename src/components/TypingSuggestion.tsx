import { useEffect, useState } from "react";

export const IDEA_EXAMPLES = [
  "A CRM for freelancers that handles invoicing",
  "A tool that turns meetings into tasks",
  "An app to schedule social posts across platforms",
  "A tool for recording and editing short videos",
];

const TYPED_EXAMPLES = [
  "A CRM for freelancers",
  "A tool for meeting notes",
  "Schedule social posts",
  "Edit short videos",
];

/** Decorative text only: never becomes the input value or an announced live region. */
export function TypingSuggestion({ paused }: { paused: boolean }) {
  const [frame, setFrame] = useState({ index: 0, text: "" });
  useEffect(() => {
    if (paused) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0,
      length = 0,
      deleting = false;
    function tick() {
      length += deleting ? -1 : 1;
      if (length === 0) {
        index = (index + 1) % TYPED_EXAMPLES.length;
        deleting = false;
      } else if (length === TYPED_EXAMPLES[index].length) {
        deleting = true;
      }
      setFrame({ index, text: TYPED_EXAMPLES[index].slice(0, length) });
      timer = setTimeout(
        tick,
        length === 0
          ? 400
          : length === TYPED_EXAMPLES[index].length
            ? 2200
            : deleting
              ? 28
              : 65,
      );
    }
    function sync() {
      clearTimeout(timer);
      if (!document.hidden && !preference.matches)
        timer = setTimeout(tick, 500);
    }
    sync();
    document.addEventListener("visibilitychange", sync);
    preference.addEventListener("change", sync);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      preference.removeEventListener("change", sync);
    };
  }, [paused]);
  return (
    <span className="ghost-suggestion" aria-hidden="true">
      <span className="suggestion-motion">
        {paused ? TYPED_EXAMPLES[frame.index] : frame.text}
        <span className="suggestion-cursor">▏</span>
      </span>
      <span className="suggestion-static">{TYPED_EXAMPLES[0]}</span>
    </span>
  );
}
