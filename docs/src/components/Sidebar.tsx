import { NavLink } from "react-router-dom";
import nav from "virtual:docs-nav";

/**
 * The document tree, built at compile time by the `docs-nav` plugin so the
 * browser never loads 84 files just to render a list of links.
 */
export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  return (
    <nav className="sidebar" aria-label="Documentation">
      {nav.map((section) => (
        <div key={section.label} className="section">
          <p className="section-label">{section.label}</p>
          <ul>
            {section.items.map((item) => (
              <li key={item.slug}>
                <NavLink
                  to={`/${item.slug}`}
                  onClick={onNavigate}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
