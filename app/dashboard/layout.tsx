// src/app/dashboard/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { LayoutDashboard, Settings } from "lucide-react";
import React from "react";

export const metadata: Metadata = {
  title: "Cooperneo — Dashboard",
};

const BRAND = {
  yellow: "#FFC107",
  yellowDark: "#FFB300",
  textDark: "#111827",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navbar */}
      <header
        className="sticky top-0 z-30 border-b"
        style={{ borderColor: "rgba(0,0,0,0.06)" }}
      >
        <div
          className="w-full"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,193,7,1) 0%, rgba(255,179,0,1) 100%)",
          }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            {/* Brand */}
            <Link href="/dashboard" className="flex items-center gap-2">
              <div
                className="h-9 w-9 rounded-xl shadow-sm"
                style={{ backgroundColor: BRAND.yellowDark }}
                aria-hidden
              />
              <div className="flex flex-col leading-tight">
                <span
                  className="text-lg font-extrabold tracking-tight"
                  style={{ color: BRAND.textDark }}
                >
                  Cooperneo
                </span>
                <span className="text-xs" style={{ color: "rgba(17,24,39,0.7)" }}>
                  Gerencie seus relatórios
                </span>
              </div>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-2">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-black/5"
                style={{ color: BRAND.textDark }}
              >
                <LayoutDashboard size={18} />
                Dashboard
              </Link>
              <Link
                href="/dashboard/configuracoes"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-black/5"
                style={{ color: BRAND.textDark }}
              >
                <Settings size={18} />
                Configurações
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
