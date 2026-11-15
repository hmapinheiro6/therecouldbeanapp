import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { PixelArt } from "./components/PixelArt";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Explore } from "./pages/Explore";
import { Product } from "./pages/Product";
import { Submit } from "./pages/Submit";
import { About, Privacy, Terms, NotFound } from "./pages/Info";
function PageMetadata() {
  const { pathname: rawPathname } = useLocation();
  const pathname = rawPathname.replace(/\/$/, "") || "/";
  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Someone probably built it.",
      "/search": "The reality check",
      "/explore": "Explore the catalog",
      "/submit": "Submit your app",
      "/about": "About",
      "/privacy": "Privacy",
      "/terms": "Terms",
    };
    if (!pathname.startsWith("/apps/"))
      document.title =
        (titles[pathname] ?? "Page not found") + " — There Could Be An App";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = pathname === "/search" ? "noindex,nofollow" : "index,follow";
    let canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = window.location.origin + pathname;
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
export function App() {
  return (
    <>
      <PageMetadata />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link
          to="/"
          className="wordmark"
          aria-label="There Could Be An App home"
        >
          <span className="brand-symbol" aria-hidden="true">
            <PixelArt kind="window" />
          </span>
          <span>
            THERE COULD BE
            <br />
            <b>AN APP.</b>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/explore">Explore</NavLink>
          <NavLink to="/submit">
            Submit your app <span aria-hidden="true">↗</span>
          </NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/apps/:slug" element={<Product />} />
          <Route path="/submit" element={<Submit />} />
          <Route path="/about" element={<About />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <div>
          <Link to="/" className="footer-brand">
            there could be an app. ↗
          </Link>
          <p>Original ideas. Previously implemented. / Keep the drawings.</p>
        </div>
        <nav aria-label="Footer">
          <Link to="/about">About</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <span>THE INVENTION ARCHIVE / EST. 2026</span>
        </nav>
      </footer>
    </>
  );
}
