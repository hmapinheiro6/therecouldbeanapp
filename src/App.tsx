import { useEffect } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { Admin } from "./pages/Admin";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Explore } from "./pages/Explore";
import { Product } from "./pages/Product";
import { Submit } from "./pages/Submit";
import { About, Privacy, Terms, NotFound } from "./pages/Info";
import { canonicalOrigin, catalogRoute, updatePageMetadata } from "./lib/seo";
function PageMetadata() {
  const { pathname: rawPathname } = useLocation();
  const pathname = rawPathname.replace(/\/$/, "") || "/";
  useEffect(() => {
    if (!/^\/apps\/[^/]+$/.test(pathname) && !catalogRoute(pathname))
      updatePageMetadata(canonicalOrigin(), pathname);
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
export function App() {
  const { pathname } = useLocation();
  return (
    <>
      <PageMetadata />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main id="main" tabIndex={-1}>
        <div className="route-content" key={pathname}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/search" element={<Search />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/explore/page/:page" element={<Explore />} />
            <Route path="/categories/:category" element={<Explore />} />
            <Route
              path="/categories/:category/page/:page"
              element={<Explore />}
            />
            <Route path="/apps/:slug" element={<Product />} />
            <Route path="/submit" element={<Submit />} />
            <Route path="/about" element={<About />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>
      <footer className="site-footer">
        <div>
          <Link to="/" className="footer-brand">
            there could be an app.
          </Link>
        </div>
        <nav aria-label="Footer">
          <Link to="/explore">Explore</Link>
          <Link to="/submit">Submit your app</Link>
          <Link to="/about">About</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </footer>
    </>
  );
}
