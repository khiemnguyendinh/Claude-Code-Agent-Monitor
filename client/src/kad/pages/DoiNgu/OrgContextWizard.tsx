import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, Upload } from "lucide-react";
import { kadApi } from "../../api-client";
import type { OrgContextData, OrgProfileRow } from "../../api-client";
import { useKadToast } from "../../components/Toast";
import {
  KadButton,
  KadCard,
  KadFieldLabel,
  KadInput,
  KadTextarea,
} from "../../components/primitives";

const STEPS = [
  "Thông tin tổ chức",
  "Tầm nhìn & Sứ mệnh",
  "Thương hiệu",
  "Sản phẩm & Dịch vụ",
  "Khách hàng mục tiêu",
  "Chiến lược",
  "SWOT",
  "Đối thủ",
  "Cơ cấu tổ chức",
  "Phòng ban",
  "Thư viện mẫu",
];

type WizardData = OrgContextData & {
  _profile: {
    name: string;
    industry: string;
    size: "1-10" | "11-50" | "51-200" | "201-500" | "500+";
    founded_year: number | null;
    logo_path?: string | null;
  };
  _org_chart_nodes: {
    id: string;
    parent_id: string | null;
    name: string;
    node_type: "company" | "department" | "position";
    lead_name?: string | null;
    mission?: string | null;
    sort_order: number;
  }[];
  _department: {
    slug: string;
    name: string;
    template_type: "rd" | "training" | "sales" | "marketing" | "finance_admin";
    mission: string;
  };
  _templates: {
    name: string;
    file_name?: string;
    template_type: string;
    purpose: string;
    content: string;
  }[];
};

function defaultData(): WizardData {
  return {
    _profile: {
      name: "Học viện Kstudy",
      industry: "Đào tạo Digital Marketing, AI & Automation",
      size: "11-50",
      founded_year: null,
    },
    vision: "",
    mission: "",
    core_values: ["AI-First", "Asset-light", "Business Automation"],
    brand: {
      voice: "",
      guideline: "",
      primary_color: "#1D237D",
      font: "Inter",
      slogan: "",
    },
    products: [{ name: "", description: "", target_audience: "" }],
    personas: [{ name: "", demographics: "", needs: "", pain_points: "", channels: "" }],
    strategy: { goals: "", priorities: "", constraints: "", roadmap: "" },
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    competitors: [],
    department_role: "Phòng R&D: xây khung chương trình, syllabus và học liệu.",
    pedagogy_standards: "CDIO, KASH, Bloom taxonomy, hybrid learning.",
    responsible_human: "anh Khiêm",
    _org_chart_nodes: [
      {
        id: "company",
        parent_id: null,
        name: "Học viện Kstudy",
        node_type: "company",
        lead_name: "anh Khiêm",
        mission: "",
        sort_order: 0,
      },
      {
        id: "rd",
        parent_id: "company",
        name: "Phòng R&D",
        node_type: "department",
        lead_name: "anh Khiêm",
        mission: "Xây hệ thống học liệu Kstudy",
        sort_order: 1,
      },
    ],
    _department: {
      slug: "rd",
      name: "Phòng R&D",
      template_type: "rd",
      mission: "Xây khung chương trình, syllabus và học liệu.",
    },
    _templates: [],
  };
}

function profileRowToWizardProfile(row: OrgProfileRow): WizardData["_profile"] {
  return {
    name: row.name,
    industry: row.industry ?? "",
    size: row.size ?? "11-50",
    founded_year: row.founded_year ?? null,
    logo_path: row.logo_path ?? null,
  };
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinLines(value: string[]): string {
  return value.join("\n");
}

function serializeWizardDraft(data: WizardData): Record<string, unknown> {
  return { ...data };
}

export function OrgContextWizard({ onCompleted }: { onCompleted: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WizardData>(() => defaultData());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useKadToast();

  useEffect(() => {
    let cancelled = false;
    kadApi.orgContext
      .wizardDraft()
      .then((row) => {
        if (cancelled || !row) return;
        const data = row.data as Partial<WizardData> & { _wizard?: { current_step?: number } };
        setDraft((prev) => ({
          ...prev,
          ...data,
          _profile:
            data._profile ?? (row.profile ? profileRowToWizardProfile(row.profile) : prev._profile),
        }));
        const savedStep = data._wizard?.current_step;
        if (typeof savedStep === "number") {
          setStep(Math.max(0, Math.min(savedStep - 1, STEPS.length - 1)));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const patchDraft = (patch: Partial<WizardData>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const saveDraft = async (nextStep = step) => {
    setSaving(true);
    setError(null);
    try {
      await kadApi.orgContext.saveWizardDraft({
        step: nextStep + 1,
        draft: serializeWizardDraft(draft),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được draft.");
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    await saveDraft(Math.min(step + 1, STEPS.length - 1));
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const complete = async () => {
    setSaving(true);
    setError(null);
    try {
      await kadApi.orgContext.saveWizardDraft({
        step: STEPS.length,
        draft: serializeWizardDraft(draft),
      });
      await kadApi.orgContext.completeWizard({ draft: serializeWizardDraft(draft) });
      toast({ message: "Đã tạo tri thức tổ chức v1.", tone: "success" });
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không hoàn tất được wizard.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-[980px] space-y-5">
      <KadCard>
        <div className="flex flex-wrap gap-1.5">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={`h-7 rounded-lg px-2.5 kad-caption ${
                i === step ? "bg-kad-primary text-white" : "bg-kad-surface-2 text-kad-text-muted"
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>
      </KadCard>

      <KadCard>
        <h2 className="kad-title text-kad-text-strong mb-4">{STEPS[step]}</h2>
        {step === 0 && <StepProfile draft={draft} patchDraft={patchDraft} />}
        {step === 1 && <StepVision draft={draft} patchDraft={patchDraft} />}
        {step === 2 && <StepBrand draft={draft} patchDraft={patchDraft} />}
        {step === 3 && <StepProduct draft={draft} patchDraft={patchDraft} />}
        {step === 4 && <StepPersona draft={draft} patchDraft={patchDraft} />}
        {step === 5 && <StepStrategy draft={draft} patchDraft={patchDraft} />}
        {step === 6 && <StepSwot draft={draft} patchDraft={patchDraft} />}
        {step === 7 && <StepCompetitors draft={draft} patchDraft={patchDraft} />}
        {step === 8 && <StepOrgChart draft={draft} patchDraft={patchDraft} />}
        {step === 9 && <StepDepartment draft={draft} patchDraft={patchDraft} />}
        {step === 10 && <StepTemplates draft={draft} patchDraft={patchDraft} />}
      </KadCard>

      {error && <p className="kad-body text-kad-danger">{error}</p>}

      <div className="flex items-center justify-between">
        <KadButton
          variant="ghost"
          disabled={step === 0 || saving}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Quay lại
        </KadButton>
        <div className="flex items-center gap-2">
          <KadButton variant="secondary" loading={saving} onClick={() => saveDraft()}>
            Lưu nháp
          </KadButton>
          {step < STEPS.length - 1 ? (
            <KadButton variant="primary" loading={saving} onClick={next}>
              Tiếp tục
            </KadButton>
          ) : (
            <KadButton variant="primary" icon={Check} loading={saving} onClick={complete}>
              Hoàn tất
            </KadButton>
          )}
        </div>
      </div>
    </div>
  );
}

function StepProfile({ draft, patchDraft }: StepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Tên tổ chức">
        <KadInput
          value={draft._profile.name}
          onChange={(e) => patchDraft({ _profile: { ...draft._profile, name: e.target.value } })}
        />
      </Field>
      <Field label="Lĩnh vực">
        <KadInput
          value={draft._profile.industry}
          onChange={(e) =>
            patchDraft({ _profile: { ...draft._profile, industry: e.target.value } })
          }
        />
      </Field>
      <Field label="Quy mô">
        <select
          value={draft._profile.size}
          onChange={(e) =>
            patchDraft({
              _profile: {
                ...draft._profile,
                size: e.target.value as WizardData["_profile"]["size"],
              },
            })
          }
          className="kad-body h-9 w-full rounded-lg bg-kad-surface-2 px-3 text-kad-text"
        >
          {["1-10", "11-50", "51-200", "201-500", "500+"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Năm thành lập">
        <KadInput
          type="number"
          value={draft._profile.founded_year ?? ""}
          onChange={(e) =>
            patchDraft({
              _profile: {
                ...draft._profile,
                founded_year: e.target.value ? Number(e.target.value) : null,
              },
            })
          }
        />
      </Field>
    </div>
  );
}

interface StepProps {
  draft: WizardData;
  patchDraft: (patch: Partial<WizardData>) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <KadFieldLabel>{label}</KadFieldLabel>
      {children}
    </div>
  );
}

function StepVision({ draft, patchDraft }: StepProps) {
  return (
    <div className="space-y-4">
      <Field label="Tầm nhìn">
        <KadTextarea
          value={draft.vision}
          onChange={(e) => patchDraft({ vision: e.target.value })}
        />
      </Field>
      <Field label="Sứ mệnh">
        <KadTextarea
          value={draft.mission}
          onChange={(e) => patchDraft({ mission: e.target.value })}
        />
      </Field>
      <Field label="Giá trị cốt lõi">
        <KadTextarea
          value={joinLines(draft.core_values)}
          onChange={(e) => patchDraft({ core_values: splitLines(e.target.value) })}
        />
      </Field>
    </div>
  );
}

function StepBrand({ draft, patchDraft }: StepProps) {
  return (
    <div className="space-y-4">
      <Field label="Brand voice">
        <KadTextarea
          value={draft.brand.voice}
          onChange={(e) => patchDraft({ brand: { ...draft.brand, voice: e.target.value } })}
          className="min-h-[120px]"
        />
      </Field>
      <Field label="Guideline">
        <KadTextarea
          value={draft.brand.guideline}
          onChange={(e) => patchDraft({ brand: { ...draft.brand, guideline: e.target.value } })}
          className="min-h-[120px]"
        />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Màu chính">
          <KadInput
            value={draft.brand.primary_color ?? ""}
            onChange={(e) =>
              patchDraft({ brand: { ...draft.brand, primary_color: e.target.value } })
            }
          />
        </Field>
        <Field label="Font">
          <KadInput
            value={draft.brand.font ?? ""}
            onChange={(e) => patchDraft({ brand: { ...draft.brand, font: e.target.value } })}
          />
        </Field>
        <Field label="Slogan">
          <KadInput
            value={draft.brand.slogan ?? ""}
            onChange={(e) => patchDraft({ brand: { ...draft.brand, slogan: e.target.value } })}
          />
        </Field>
      </div>
    </div>
  );
}

function StepProduct({ draft, patchDraft }: StepProps) {
  const p = draft.products[0] ?? { name: "", description: "", target_audience: "" };
  return (
    <div className="grid grid-cols-1 gap-4">
      <Field label="Tên sản phẩm">
        <KadInput
          value={p.name}
          onChange={(e) => patchDraft({ products: [{ ...p, name: e.target.value }] })}
        />
      </Field>
      <Field label="Mô tả">
        <KadTextarea
          value={p.description}
          onChange={(e) => patchDraft({ products: [{ ...p, description: e.target.value }] })}
        />
      </Field>
      <Field label="Đối tượng">
        <KadInput
          value={p.target_audience}
          onChange={(e) => patchDraft({ products: [{ ...p, target_audience: e.target.value }] })}
        />
      </Field>
    </div>
  );
}

function StepPersona({ draft, patchDraft }: StepProps) {
  const p = draft.personas[0] ?? {
    name: "",
    demographics: "",
    needs: "",
    pain_points: "",
    channels: "",
  };
  const update = (patch: Partial<(typeof draft.personas)[number]>) =>
    patchDraft({ personas: [{ ...p, ...patch }] });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Persona">
        <KadInput value={p.name} onChange={(e) => update({ name: e.target.value })} />
      </Field>
      <Field label="Demographics">
        <KadInput
          value={p.demographics}
          onChange={(e) => update({ demographics: e.target.value })}
        />
      </Field>
      <Field label="Nhu cầu">
        <KadTextarea value={p.needs} onChange={(e) => update({ needs: e.target.value })} />
      </Field>
      <Field label="Pain points">
        <KadTextarea
          value={p.pain_points}
          onChange={(e) => update({ pain_points: e.target.value })}
        />
      </Field>
      <Field label="Kênh tiếp cận">
        <KadInput value={p.channels} onChange={(e) => update({ channels: e.target.value })} />
      </Field>
    </div>
  );
}

function StepStrategy({ draft, patchDraft }: StepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {(["goals", "priorities", "constraints", "roadmap"] as const).map((key) => (
        <Field key={key} label={key}>
          <KadTextarea
            value={draft.strategy[key]}
            onChange={(e) => patchDraft({ strategy: { ...draft.strategy, [key]: e.target.value } })}
          />
        </Field>
      ))}
    </div>
  );
}

function StepSwot({ draft, patchDraft }: StepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {(["strengths", "weaknesses", "opportunities", "threats"] as const).map((key) => (
        <Field key={key} label={key}>
          <KadTextarea
            value={joinLines(draft.swot[key])}
            onChange={(e) =>
              patchDraft({ swot: { ...draft.swot, [key]: splitLines(e.target.value) } })
            }
          />
        </Field>
      ))}
    </div>
  );
}

function StepCompetitors({ draft, patchDraft }: StepProps) {
  const text = draft.competitors
    .map((c) => [c.name, c.strengths, c.weaknesses, c.differentiator].join(" | "))
    .join("\n");
  return (
    <Field label="Đối thủ">
      <KadTextarea
        value={text}
        className="min-h-[180px]"
        onChange={(e) =>
          patchDraft({
            competitors: splitLines(e.target.value).map((line) => {
              const [name = "", strengths = "", weaknesses = "", differentiator = ""] = line
                .split("|")
                .map((s) => s.trim());
              return { name, strengths, weaknesses, differentiator };
            }),
          })
        }
      />
    </Field>
  );
}

function StepOrgChart({ draft, patchDraft }: StepProps) {
  const updateNode = (id: string, patch: Partial<WizardData["_org_chart_nodes"][number]>) =>
    patchDraft({
      _org_chart_nodes: draft._org_chart_nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    });
  return (
    <div className="space-y-2">
      {draft._org_chart_nodes.map((node) => (
        <div
          key={node.id}
          className="grid grid-cols-1 sm:grid-cols-[1fr_160px_1fr] gap-2 border border-kad-border rounded-lg p-3"
        >
          <KadInput
            value={node.name}
            onChange={(e) => updateNode(node.id, { name: e.target.value })}
          />
          <select
            value={node.node_type}
            onChange={(e) =>
              updateNode(node.id, {
                node_type: e.target.value as WizardData["_org_chart_nodes"][number]["node_type"],
              })
            }
            className="kad-body h-9 rounded-lg bg-kad-surface-2 px-3 text-kad-text"
          >
            <option value="company">company</option>
            <option value="department">department</option>
            <option value="position">position</option>
          </select>
          <KadInput
            value={node.parent_id ?? ""}
            placeholder="parent id"
            onChange={(e) => updateNode(node.id, { parent_id: e.target.value || null })}
          />
        </div>
      ))}
      <KadButton
        variant="ghost"
        onClick={() =>
          patchDraft({
            _org_chart_nodes: [
              ...draft._org_chart_nodes,
              {
                id: `node-${draft._org_chart_nodes.length + 1}`,
                parent_id: "rd",
                name: "Vị trí mới",
                node_type: "position",
                sort_order: draft._org_chart_nodes.length,
              },
            ],
          })
        }
      >
        Thêm node
      </KadButton>
    </div>
  );
}

function StepDepartment({ draft, patchDraft }: StepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Tên phòng ban">
        <KadInput
          value={draft._department.name}
          onChange={(e) =>
            patchDraft({ _department: { ...draft._department, name: e.target.value } })
          }
        />
      </Field>
      <Field label="Template">
        <select
          value={draft._department.template_type}
          onChange={(e) =>
            patchDraft({
              _department: {
                ...draft._department,
                template_type: e.target.value as WizardData["_department"]["template_type"],
              },
            })
          }
          className="kad-body h-9 w-full rounded-lg bg-kad-surface-2 px-3 text-kad-text"
        >
          {["rd", "training", "sales", "marketing", "finance_admin"].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Mission">
          <KadTextarea
            value={draft._department.mission}
            onChange={(e) =>
              patchDraft({ _department: { ...draft._department, mission: e.target.value } })
            }
          />
        </Field>
      </div>
    </div>
  );
}

function StepTemplates({ draft, patchDraft }: StepProps) {
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    patchDraft({
      _templates: [
        ...draft._templates,
        {
          name: file.name.replace(/\.md$/i, ""),
          file_name: file.name,
          template_type: "custom",
          purpose: "Custom template",
          content,
        },
      ],
    });
  };
  return (
    <div className="space-y-3">
      <p className="kad-body text-kad-text-muted">
        Seed mặc định gồm 6 template R&D. File upload sẽ thêm vào thư viện.
      </p>
      <label className="inline-flex">
        <input
          type="file"
          accept=".md"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <span className="kad-label inline-flex h-9 items-center gap-1.5 rounded-lg border border-kad-border-strong px-3 text-kad-text cursor-pointer">
          <Upload className="w-4 h-4" aria-hidden />
          Upload .md
        </span>
      </label>
      {draft._templates.map((tpl) => (
        <div
          key={`${tpl.file_name}-${tpl.content.length}`}
          className="border border-kad-border rounded-lg px-3 py-2"
        >
          <p className="kad-body text-kad-text">{tpl.name}</p>
          <p className="kad-caption text-kad-text-faint">
            {tpl.content.length.toLocaleString("vi-VN")} ký tự
          </p>
        </div>
      ))}
    </div>
  );
}
