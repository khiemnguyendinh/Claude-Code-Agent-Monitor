/**
 * @file App.tsx
 * @description Defines the main application component that sets up routing for different pages, manages WebSocket connections for real-time updates, and initializes notifications. It uses React Router for navigation and custom hooks for WebSocket and notification handling.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useCallback } from "react";
import { Layout } from "./components/Layout";
import { SplashScreen } from "./components/SplashScreen";
import { Dashboard } from "./pages/Dashboard";
import { KanbanBoard } from "./pages/KanbanBoard";
import { Sessions } from "./pages/Sessions";
import { SessionDetail } from "./pages/SessionDetail";
import { ActivityFeed } from "./pages/ActivityFeed";
import { Analytics } from "./pages/Analytics";
import { Workflows } from "./pages/Workflows";
import { Settings } from "./pages/Settings";
import { CcConfig } from "./pages/CcConfig";
import { Run } from "./pages/Run";
import { NotFound } from "./pages/NotFound";
import { useWebSocket } from "./hooks/useWebSocket";
import { useNotifications } from "./hooks/useNotifications";
import { eventBus } from "./lib/eventBus";
import type { WSMessage } from "./lib/types";
import { KadShell } from "./kad/components/KadShell";
import { TongQuan } from "./kad/pages/TongQuan";
import { MucTieuChienLuoc } from "./kad/pages/MucTieuChienLuoc";
import { CongViecMoi } from "./kad/pages/CongViecMoi";
import { CongViecLayout } from "./kad/pages/CongViecLayout";
import { TuDongHoa } from "./kad/pages/TuDongHoa";
import { TraoDoiCongViec } from "./kad/pages/TraoDoiCongViec";
import { DoiNgu } from "./kad/pages/DoiNgu";
import { HocLieu } from "./kad/pages/HocLieu";
import { BaoCao } from "./kad/pages/BaoCao";
import { LearningNotes } from "./kad/pages/LearningNotes";

// Old top-level paths the monitor used before KAD claimed "/" for Tổng quan.
// Kept as redirects (not deletions) so existing bookmarks/tabs still land
// somewhere useful instead of 404ing — spec/05-ui-spec.md §5 only requires
// the monitor pages themselves to stay untouched, not their old URLs.
const LEGACY_MONITOR_REDIRECTS: Array<{ from: string; to: string }> = [
  { from: "/kanban", to: "/he-thong/kanban" },
  { from: "/sessions", to: "/he-thong/sessions" },
  { from: "/sessions/:id", to: "/he-thong/sessions/:id" },
  { from: "/activity", to: "/he-thong/activity" },
  { from: "/analytics", to: "/he-thong/analytics" },
  { from: "/workflows", to: "/he-thong/workflows" },
  { from: "/cc-config", to: "/he-thong/cc-config" },
  { from: "/run", to: "/he-thong/run" },
  { from: "/settings", to: "/he-thong/settings" },
];

export default function App() {
  const onMessage = useCallback((msg: WSMessage) => {
    eventBus.publish(msg);
  }, []);

  const { connected } = useWebSocket(onMessage);
  useNotifications();

  return (
    <>
      <SplashScreen />
      <BrowserRouter>
        <Routes>
          {/* KAD ("Kstudy Flat") — Tổng quan / Công việc / Đội ngũ + kho phụ.
              New screens per plans/260703-2330-kad-v2-build/spec/ui/*.md. */}
          <Route element={<KadShell wsConnected={connected} />}>
            <Route index element={<TongQuan />} />
            <Route path="muc-tieu-chien-luoc" element={<MucTieuChienLuoc />} />
            {/* 2026-07-04: board "Công việc" (5 cột task KAD) đã gộp vào trang
                Kanban (/he-thong/kanban) để bỏ trùng lặp — xem
                spec/ui/08-gop-cong-viec-kanban.md. "/cong-viec" giờ redirect
                sang đó; luồng Giao việc giữ nguyên ở /cong-viec/moi (hero
                composer) và /cong-viec/:id (trao đổi). */}
            <Route path="cong-viec" element={<CongViecLayout />}>
              <Route index element={<Navigate to="/cong-viec/moi" replace />} />
              <Route path="moi" element={<CongViecMoi />} />
              <Route path="tu-dong-hoa" element={<TuDongHoa />} />
              <Route path=":id" element={<TraoDoiCongViec />} />
            </Route>
            <Route path="doi-ngu" element={<DoiNgu />} />
            <Route path="hoc-lieu" element={<HocLieu />} />
            <Route path="bao-cao" element={<BaoCao />} />
            <Route path="bao-cao/learning" element={<LearningNotes />} />
          </Route>

          {/* Monitor gốc — pages/functionality untouched, only reparented
              under /he-thong/* (dark theme preserved on purpose). */}
          <Route path="he-thong" element={<Layout wsConnected={connected} />}>
            <Route index element={<Dashboard />} />
            <Route path="kanban" element={<KanbanBoard />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="sessions/:id" element={<SessionDetail />} />
            <Route path="activity" element={<ActivityFeed />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="workflows" element={<Workflows />} />
            <Route path="cc-config" element={<CcConfig />} />
            <Route path="run" element={<Run />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>

          {LEGACY_MONITOR_REDIRECTS.map(({ from, to }) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}
