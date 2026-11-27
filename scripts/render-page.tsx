import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { App } from "../src/App";
import { InitialData } from "../src/lib/initial-data";
import {
  catalogResponse,
  type PublishedCatalog,
} from "../src/lib/static-catalog";

export function renderPage(pathname: string, catalog: PublishedCatalog) {
  const responses: Record<string, unknown> = {};
  const getData = (path: string) => {
    // Forms always refresh live configuration in the browser.
    if (path === "/config") return undefined;
    try {
      return (responses[path] = catalogResponse(catalog, path));
    } catch {
      return undefined;
    }
  };
  const body = renderToString(
    <InitialData.Provider value={getData}>
      <StaticRouter location={pathname}>
        <App />
      </StaticRouter>
    </InitialData.Provider>,
  );
  return {
    body,
    data: JSON.stringify({ pathname, responses }).replace(/</g, "\\u003c"),
  };
}
