/**
 * KAD app shell — 01-app-shell.md §1. Composition root for the new
 * ("Kstudy Flat") screens: sidebar + topbar + content + the cross-cutting
 * peek drawer / ⌘K / toast layers. Mounted only for the KAD routes; the
 * original monitor Layout (client/src/components/Layout.tsx) is untouched
 * and keeps serving everything under /he-thong/*.
 *
 * 2026-07-04: sidebar is no longer KAD-specific — both shells render the
 * exact same AppSidebar (client/src/components/AppSidebar.tsx), including
 * its collapse behavior, so this shell now lays out its main content with
 * the same fixed-sidebar + margin-left pattern as Layout.tsx instead of a
 * flex row (that's what made collapse possible here in the first place).
 */
import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar, SIDEBAR_STORAGE_KEY, loadCollapsed } from "../../components/AppSidebar";
import { Topbar } from "./Topbar";
import { PeekDrawerHost } from "./PeekDrawer";
import { CommandPalette, useCommandPaletteHotkey } from "./CommandPalette";
import { KadStoreProvider } from "../store";
import { KadToastProvider } from "./Toast";

interface KadShellInnerProps {
  wsConnected: boolean;
}

function KadShellInner({ wsConnected }: KadShellInnerProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  useCommandPaletteHotkey(() => setPaletteOpen(true));

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <PeekDrawerHost>
      <div className="min-h-screen bg-kad-bg">
        <AppSidebar wsConnected={wsConnected} collapsed={collapsed} onToggle={toggle} />
        <div
          className="min-h-screen min-w-0 flex flex-col transition-[margin-left,width] duration-200"
          style={{
            marginLeft: collapsed ? "4.25rem" : "15rem",
            width: collapsed ? "calc(100% - 4.25rem)" : "calc(100% - 15rem)",
          }}
        >
          <Topbar onOpenPalette={() => setPaletteOpen(true)} />
          <main className="flex-1 min-w-0 max-w-[1440px] w-full mx-auto px-6 py-6">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </PeekDrawerHost>
  );
}

interface KadShellProps {
  wsConnected: boolean;
}

export function KadShell({ wsConnected }: KadShellProps) {
  // index.html already defaults <body> to this color (KAD is the primary
  // landing route), but explicitly syncing it here means switching over
  // from /he-thong/* (which sets its own dark body bg — see Layout.tsx)
  // always re-syncs correctly, and macOS trackpad overscroll-bounce at the
  // top/bottom/side edges never flashes the wrong theme underneath.
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "var(--kad-bg)";
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div className="kad-root">
      <KadStoreProvider>
        <KadToastProvider>
          <KadShellInner wsConnected={wsConnected} />
        </KadToastProvider>
      </KadStoreProvider>
    </div>
  );
}
