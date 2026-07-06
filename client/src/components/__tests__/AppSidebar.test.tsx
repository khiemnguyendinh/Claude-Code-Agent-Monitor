/**
 * @file AppSidebar.test.tsx
 * @description Unit tests for the single shared AppSidebar (used by both the
 * KAD shell and the /he-thong shell as of the 2026-07-04 sidebar-unification
 * pass). Covers brand, the new nav structure, connection status, version,
 * and the language switcher.
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppSidebar } from "../AppSidebar";

function renderSidebar(wsConnected: boolean, collapsed = false) {
  return render(
    <MemoryRouter>
      <AppSidebar wsConnected={wsConnected} collapsed={collapsed} onToggle={() => {}} />
    </MemoryRouter>
  );
}

describe("AppSidebar", () => {
  it("should render the brand name", () => {
    renderSidebar(true);
    expect(screen.getByText("Kstudy Curriculum R&D")).toBeInTheDocument();
  });

  it("should render the Giao việc quick-create action", () => {
    renderSidebar(true);
    expect(screen.getByTitle("Giao việc")).toBeInTheDocument();
  });

  it("should render all main navigation links", () => {
    renderSidebar(true);
    expect(screen.getByText("Tổng quan")).toBeInTheDocument();
    expect(screen.getByText("Công việc")).toBeInTheDocument();
    expect(screen.getByText("Đội ngũ")).toBeInTheDocument();
    expect(screen.getByText("Kho học liệu")).toBeInTheDocument();
  });

  it("should render the Hệ thống group", () => {
    renderSidebar(true);
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
    expect(screen.getByText("Hệ Thống")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("Setting")).toBeInTheDocument();
  });

  it('should show "Live" when WebSocket is connected', () => {
    renderSidebar(true);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it('should show "Disconnected" when WebSocket is not connected', () => {
    renderSidebar(false);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("should show version number", () => {
    renderSidebar(true);
    expect(screen.getByText("v2.0")).toBeInTheDocument();
  });

  it("should have correct navigation hrefs", () => {
    renderSidebar(true);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/he-thong/kanban");
    expect(hrefs).toContain("/doi-ngu");
    expect(hrefs).toContain("/hoc-lieu");
    expect(hrefs).toContain("/he-thong");
    expect(hrefs).toContain("/he-thong/analytics");
    expect(hrefs).toContain("/he-thong/settings");
  });

  it("should render three language options in expanded mode", () => {
    renderSidebar(true);
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chinese" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vietnamese" })).toBeInTheDocument();
  });

  it("should cycle language in collapsed mode", async () => {
    const user = userEvent.setup();
    renderSidebar(true, true);

    // test-setup.ts forces "en" before every test, so the cycle (en -> zh -> vi) starts here.
    expect(screen.getByText("EN")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));

    await waitFor(() => {
      expect(screen.getByText("中文")).toBeInTheDocument();
    });
  });
});
