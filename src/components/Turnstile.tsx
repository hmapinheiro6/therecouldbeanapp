import { useEffect, useRef } from "react";
interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
export function Turnstile({
  siteKey,
  onToken,
  resetKey,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  resetKey: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    let widget: string | undefined,
      cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widget = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        action: "submit",
        theme: "light",
        callback: (token: string) => callback.current(token),
        "expired-callback": () => callback.current(""),
        "error-callback": () => callback.current(""),
      });
    };
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-turnstile]",
    );
    if (window.turnstile) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.dataset.turnstile = "true";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      cancelled = true;
      script?.removeEventListener("load", render);
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, resetKey]);
  return <div ref={ref} className="turnstile" aria-label="Spam protection" />;
}
