"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: Route;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/" as Route, label: "Traductor" },
  { href: "/dictionary" as Route, label: "Diccionario" },
  { href: "/preseed" as Route, label: "Preseed" },
  { href: "/rae" as Route, label: "RAE" }
];

export function AppNavbar() {
  const pathname = usePathname();

  return (
    <header className="app-navbar-shell">
      <div className="app-navbar">
        <Link href={"/" as Route} className="brand-mark" aria-label="Ir al traductor">
          <span className="brand-dot" aria-hidden="true" />
          <strong>Arcania</strong>
          <small>Language Lab</small>
        </Link>

        <nav className="app-nav-links" aria-label="Navegacion principal">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link key={item.href} href={item.href} className={isActive ? "app-nav-link is-active" : "app-nav-link"}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
