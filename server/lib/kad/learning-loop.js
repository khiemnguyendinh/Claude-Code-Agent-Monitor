const repo = require("./repo");
const { getAdapter } = require("./runner/adapter");
const prompts = require("./prompts");

// Must match the CHECK(correction_category IN (...)) constraint in
// server/migrations/kad-001-init.sql. An LLM-returned category outside this
// set previously hit the raw DB constraint and silently dropped the note.
const VALID_CATEGORIES = new Set([
  "missing_context",
  "weak_instruction",
  "wrong_flow",
  "bad_role_split",
  "brand_mismatch",
  "pedagogical_error",
  "factual_error",
  "format_error",
]);

function normalizeCategory(category) {
  return VALID_CATEGORIES.has(category) ? category : "wrong_flow";
}

async function analyzeLearningNote(payload) {
  console.log("[LearningLoop] Started analyzeLearningNote for task:", payload.task_id);
  try {
    const adapter = getAdapter("claude");
    const prompt = prompts.render("learning-note", {
      artifact_title: payload.artifact_title || "N/A",
      artifact_content: payload.artifact_content || "N/A",
      feedback_content: payload.feedback_content,
    });
    const req = {
      runId: "analyze-note-" + Date.now(),
      userMessage: prompt,
      maxTurns: 1,
    };
    console.log("[LearningLoop] Calling adapter.run...");
    const result = await adapter.run(req);
    console.log("[LearningLoop] Adapter returned. Parsing...");
    let noteData;
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        noteData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      noteData = {
        correction_category: "unknown",
        severity: "major",
        root_cause: payload.feedback_content,
        prevention: "N/A",
        affected_areas: ["flow"],
        proposed_change_target: "blueprint",
      };
    }
    const category = normalizeCategory(noteData.correction_category);
    repo.learning.createNote({
      department_id: payload.department_id,
      task_id: payload.task_id,
      artifact_id: payload.artifact_id,
      trigger_type: payload.trigger_type,
      correction_category: category,
      severity: noteData.severity || "major",
      root_cause: noteData.root_cause || payload.feedback_content,
      prevention: noteData.prevention || "N/A",
      affected_areas: noteData.affected_areas || ["flow"],
      proposed_change_target: noteData.proposed_change_target || "blueprint",
      feedback_content: payload.feedback_content,
      change_status: "noted",
    });
    repo.jobs.enqueue({
      kind: "pattern_detect",
      payload: { department_id: payload.department_id, category },
      dedupKey: `pattern_detect:${payload.department_id}:${category}`,
    });
    console.log("[LearningLoop] Successfully enqueued pattern_detect.");
  } catch (error) {
    console.error("Failed to analyze learning note:", error);
  }
}

module.exports = { analyzeLearningNote };
