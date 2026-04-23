module.exports = async ({ github, context, core }) => {
  const monitoredNames = new Set([
    "App Build",
    "Codecov Tests and Upload Coverage",
    "Lines of Code",
    "Security Scanning",
    "Repository file sizes",
  ]);

  const { owner, repo } = context.repo;
  const headSha = context.payload.workflow_run.head_sha;
  const currentEvent = context.payload.workflow_run.event;

  const { data } = await github.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    head_sha: headSha,
    per_page: 100,
  });

  const candidates = data.workflow_runs.filter((run) => {
    return monitoredNames.has(run.name) && run.event === currentEvent;
  });

  const latestRunByWorkflowId = new Map();
  for (const run of candidates) {
    const existing = latestRunByWorkflowId.get(run.workflow_id);
    if (!existing) {
      latestRunByWorkflowId.set(run.workflow_id, run);
      continue;
    }

    const runIsNewer =
      run.run_attempt > existing.run_attempt ||
      (run.run_attempt === existing.run_attempt && run.id > existing.id);

    if (runIsNewer) {
      latestRunByWorkflowId.set(run.workflow_id, run);
    }
  }

  const latestRuns = [...latestRunByWorkflowId.values()];
  const pendingRuns = latestRuns.filter((run) => run.status !== "completed");
  const failedRuns = latestRuns.filter(
    (run) => run.status === "completed" && run.conclusion !== "success"
  );
  const allComplete = latestRuns.length > 0 && pendingRuns.length === 0;
  const allSuccess = allComplete && failedRuns.length === 0;

  const details = latestRuns
    .map((run) => {
      const icon =
        run.conclusion === "success" ? "✅" :
        run.conclusion === "failure" ? "❌" : "⏳";
      return `${icon} [${run.name}](${run.html_url}): ${run.conclusion || run.status}`;
    })
    .join("\n");

  const failedDetails = failedRuns
    .map((run) => `❌ [${run.name}](${run.html_url}): **${run.conclusion}**`)
    .join("\n");

  let changesUrl = "";
  const headBranch = context.payload.workflow_run.head_branch;

  if (currentEvent === "pull_request") {
    const pulls = await github.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${headBranch}`,
      state: "open",
      per_page: 1,
    });
    if (pulls.data.length > 0) {
      changesUrl = pulls.data[0].html_url;
    }
  }

  if (!changesUrl) {
    changesUrl = `${context.payload.repository.html_url}/commit/${headSha}`;
  }

  core.setOutput("all_complete", allComplete ? "true" : "false");
  core.setOutput("all_success", allSuccess ? "true" : "false");
  core.setOutput("has_failures", failedRuns.length > 0 ? "true" : "false");
  core.setOutput("failed_count", String(failedRuns.length));
  core.setOutput("details", details || "- No monitored runs found");
  core.setOutput("failed_details", failedDetails);
  core.setOutput("head_sha", headSha);
  core.setOutput("head_branch", headBranch);
  core.setOutput("event_name", currentEvent);
  core.setOutput("run_url", context.payload.workflow_run.html_url);
  core.setOutput("changes_url", changesUrl);
};
