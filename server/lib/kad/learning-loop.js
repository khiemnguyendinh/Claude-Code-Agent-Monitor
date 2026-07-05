const repo = require("./repo");
const { getAdapter } = require("./runner/adapter");
const prompts = require("./prompts");

async function analyzeLearningNote(payload) {
  console.log("[LearningLoop] Started analyzeLearningNote for task:", payload.task_id);
  try {
    const adapter = getAdapter("claude");
    const prompt = prompts.render("learning-note", {
      artifact_title: payload.artifact_title || "N/A",
      artifact_content: payload.artifact_content || "N/A",
      feedback_content: payload.feedback_content
    });
    const req = {
      runId: "analyze-note-" + Date.now(),
      userMessage: prompt,
      maxTurns: 1
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
    } catch(e) {
      noteData = {
        correction_category: "unknown",
        severity: "major",
        root_cause: payload.feedback_content,
        prevention: "N/A",
        affected_areas: ["flow"],
        proposed_change_target: "blueprint"
      };
    }
    repo.learning.createNote({
      department_id: payload.department_id,
      task_id: payload.task_id,
      artifact_id: payload.artifact_id,
      trigger_type: payload.trigger_type,
      correction_category: noteData.correction_category || "unknown",
      severity: noteData.severity || "major",
      root_cause: noteData.root_cause || payload.feedback_content,
      prevention: noteData.prevention || "N/A",
      affected_areas: noteData.affected_areas || ["flow"],
      proposed_change_target: noteData.proposed_change_target || "blueprint",
      feedback_content: payload.feedback_content,
      change_status: "noted"
    });
    repo.jobs.enqueue({
      kind: "pattern_detect",
      payload: { department_id: payload.department_id, category: noteData.correction_category },
      dedupKey: `pattern_detect:${payload.department_id}:${noteData.correction_category}`
    });
    console.log("[LearningLoop] Successfully enqueued pattern_detect.");
  } catch (error) {
    console.error("Failed to analyze learning note:", error);
  }
}

module.exports = { analyzeLearningNote };
