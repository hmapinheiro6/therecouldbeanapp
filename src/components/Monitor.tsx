import { useState, type ReactNode } from "react";

const messages = [
  "Describe. Search. Reconsider.",
  "Name the task. Then who needs it.",
  "Already built? A useful difference is still an idea.",
  "42. The answer to everything. Market research sold separately.",
];

export function Monitor({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState(0);
  return (
    <div className="monitor-assembly">
      <div className="monitor-case">
        <span className="case-screw screw-left" aria-hidden="true" />
        <span className="case-screw screw-right" aria-hidden="true" />
        <div className="monitor-glass">
          <div className="monitor-screen">{children}</div>
        </div>
        <div className="monitor-chin">
          <span className="monitor-maker" aria-hidden="true">
            tcba<span>•</span>
          </span>
          <p id="machine-hint" className="monitor-message" role="status">
            {messages[screen]}
          </p>
          <button
            type="button"
            className="monitor-power"
            aria-label="Press the monitor power button for a thought"
            aria-describedby="machine-hint"
            onClick={() => setScreen((value) => (value + 1) % messages.length)}
            title="A little power for your next idea"
          >
            <span className="power-led" aria-hidden="true" />
            <span aria-hidden="true">⏻</span>
          </button>
          <span className="monitor-vents" aria-hidden="true" />
        </div>
      </div>
      <div className="monitor-stand" aria-hidden="true" />
      <div className="monitor-foot" aria-hidden="true" />
    </div>
  );
}
