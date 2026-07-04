/**
 * Màn Đội ngũ (`/doi-ngu`) — spec/ui/04-man-doi-ngu.md
 * "Phòng của tôi gồm những ai, tổ chức ra sao, vận hành theo luật nào — và
 * chỉnh ở đâu?" 4 tabs, mặc định Tổ chức.
 */
import { useState } from "react";
import { Tabs } from "../../components/Tabs";
import { ToChucTab } from "./ToChucTab";
import { MucTieuTab } from "./MucTieuTab";
import { VanHoaTab } from "./VanHoaTab";
import { JDKyNangTab } from "./JDKyNangTab";
import { KiemSoatTab } from "./KiemSoatTab";
import { Workflows } from "../../../pages/Workflows";

const TABS = [
  { key: "to-chuc", label: "Tổ chức" },
  { key: "muc-tieu", label: "Mục tiêu" },
  { key: "van-hoa", label: "Văn hóa & Nguyên tắc" },
  { key: "jd-ky-nang", label: "JD & Kỹ năng" },
  { key: "kiem-soat", label: "Kiểm soát & Phân quyền" },
  // 2026-07-04: he-thong/workflows folded in as a 5th tab per Khiêm's spec
  // (unified sidebar drops the standalone "Workflows" nav item).
  { key: "workflow", label: "Workflow" },
];

export function DoiNgu() {
  const [active, setActive] = useState("to-chuc");

  return (
    <div className="pb-10">
      <h1 className="kad-title text-kad-text-strong mb-4">Đội ngũ</h1>
      <Tabs items={TABS} active={active} onChange={setActive} />
      <div className="mt-5">
        {active === "to-chuc" && <ToChucTab />}
        {active === "muc-tieu" && <MucTieuTab />}
        {active === "van-hoa" && <VanHoaTab />}
        {active === "jd-ky-nang" && <JDKyNangTab />}
        {active === "kiem-soat" && <KiemSoatTab />}
        {active === "workflow" && <Workflows />}
      </div>
    </div>
  );
}
