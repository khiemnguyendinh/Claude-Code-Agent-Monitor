/**
 * @file server/routes/kad/knowledge.js — Phase 4 org context, setup wizard,
 * template library, org chart, and blueprint versioning endpoints.
 */
const express = require("express");
const repo = require("../../lib/kad/repo");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

function deptId(input) {
  if (input) {
    const byId = repo.catalog.getDepartment(input);
    if (byId) return byId.id;
    const bySlug = repo.catalog.getDepartmentBySlug(input);
    if (bySlug) return bySlug.id;
  }
  const d = repo.catalog.getDepartmentBySlug("rd");
  return d ? d.id : null;
}

function orgId(input) {
  if (input) return input;
  const current = repo.orgContext.getCurrent();
  return current ? current.org_id : null;
}

function safe(res, fn) {
  try {
    return fn();
  } catch (e) {
    return err(res, "EBADREQUEST", e && e.message ? e.message : "bad request");
  }
}

// ---- Org context ----
router.get("/org-context/current", (req, res) => {
  const current = repo.orgContext.getCurrent();
  if (!current) return err(res, "ENOCONTEXT", "no approved org context", 404);
  res.json(current);
});

router.get("/org-context/versions", (req, res) => {
  res.json(repo.orgContext.listVersions({ org_id: orgId(req.query.org) }));
});

router.post("/org-context/versions", (req, res) =>
  safe(res, () =>
    res.status(201).json(
      repo.orgContext.createDraftVersion({
        org_id: req.body && req.body.org_id,
        data: req.body && req.body.data,
        change_summary: req.body && req.body.change_summary,
        actor_id: "human",
      })
    )
  )
);

router.post("/org-context/versions/:id/approve", (req, res) =>
  safe(res, () => {
    const version = repo.orgContext.approveVersion(req.params.id, { actor_id: "human" });
    if (!version) return err(res, "ENOTFOUND", "org context version not found", 404);
    res.json(version);
  })
);

// ---- Setup wizard ----
router.get("/wizard/draft", (req, res) => {
  res.json(repo.orgContext.getWizardDraft() || null);
});

router.post("/wizard/draft", (req, res) =>
  safe(res, () =>
    res.json(
      repo.orgContext.saveWizardDraft({
        step: req.body && req.body.step,
        data: req.body && req.body.data,
        draft: req.body && req.body.draft,
      })
    )
  )
);

router.post("/wizard/complete", (req, res) =>
  safe(res, () => res.status(201).json(repo.orgContext.completeWizard(req.body || {})))
);

// ---- Org chart ----
router.get("/org-chart", (req, res) => {
  const id = orgId(req.query.org);
  res.json(id ? repo.orgContext.listOrgChart(id) : []);
});

router.put("/org-chart", (req, res) =>
  safe(res, () => {
    const id = orgId(req.body && req.body.org_id);
    if (!id) return err(res, "ENOCONTEXT", "organization not found", 404);
    res.json(repo.orgContext.replaceOrgChart(id, (req.body && req.body.nodes) || []));
  })
);

// ---- Templates ----
router.get("/templates", (req, res) => {
  res.json(
    repo.templates.listTemplates({
      department_id: deptId(req.query.department),
      type: req.query.type,
      status: req.query.status || "active",
      version_status: req.query.version_status,
    })
  );
});

router.post("/templates", (req, res) =>
  safe(res, () =>
    res.status(201).json(
      repo.templates.createDraft({
        ...(req.body || {}),
        department_id: deptId((req.body && req.body.department_id) || req.query.department),
        actor_id: "human",
      })
    )
  )
);

router.post("/templates/:id/approve", (req, res) =>
  safe(res, () => {
    const result = repo.templates.approve(req.params.id, { actor_id: "human" });
    if (!result) return err(res, "ENOTFOUND", "template draft not found", 404);
    res.json(result);
  })
);

router.get("/templates/:id/usage", (req, res) => {
  res.json(repo.templates.usage(req.params.id));
});

// ---- Blueprints ----
router.get("/blueprints", (req, res) => {
  res.json(repo.orgContext.listBlueprints({ department_id: deptId(req.query.department) }));
});

router.post("/blueprints/:id/propose", (req, res) =>
  safe(res, () => {
    const result = repo.orgContext.proposeBlueprint(req.params.id, {
      data: req.body && req.body.data,
      change_summary: req.body && req.body.change_summary,
      actor_id: (req.body && req.body.proposed_by) || "main-agent-rd",
    });
    if (!result) return err(res, "ENOTFOUND", "blueprint not found", 404);
    res.status(201).json(result);
  })
);

router.post("/blueprints/:id/decide", (req, res) =>
  safe(res, () => {
    const result = repo.orgContext.decideBlueprint(req.params.id, {
      decision: req.body && req.body.decision,
      reason: req.body && req.body.reason,
      actor_id: "human",
    });
    if (!result) return err(res, "ENOTFOUND", "blueprint not found", 404);
    res.json(result);
  })
);

module.exports = router;
