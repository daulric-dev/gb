import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useTheme } from "../lib/useTheme";
import { Sidebar } from "./Sidebar";
import { Doc } from "./Doc";

export function App() {
  const [dark, setDark] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // A fresh page starts at the top, unless an anchor says otherwise.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="layout">
      <header className="topbar">
        <button
          className="menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
        >
          ☰
        </button>
        <NavLink to="/" className="brand">
          GradeBook <span>Docs</span>
        </NavLink>
        <div className="topbar-actions">
          <a
            href="https://github.com/daulric-dev/gb"
            target="_blank"
            rel="noreferrer noopener"
          >
            GitHub
          </a>
          <button
            className="theme-toggle"
            onClick={() => setDark((d) => !d)}
            aria-label="Toggle theme"
          >
            {dark ? "☀" : "☾"}
          </button>
        </div>
      </header>

      <div className={`body ${menuOpen ? "menu-open" : ""}`}>
        <Sidebar onNavigate={() => setMenuOpen(false)} />
        <main>
          <Routes>
            <Route path="/*" element={<Doc />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
