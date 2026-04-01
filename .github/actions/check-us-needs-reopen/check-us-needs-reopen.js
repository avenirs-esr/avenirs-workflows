const { reqEnv, norm, appendOutputs } = require("../_shared/utils");
const { getIssueProjectItems } = require("../_shared/github");

(async () => {
  const token = reqEnv("TOKEN");
  const usIssueNodeId = reqEnv("US_ISSUE_NODE_ID");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));
  const wantedUsType = reqEnv("US_ISSUE_TYPE");
  const completedStatuses = reqEnv("COMPLETED_STATUS_NAMES")
    .split(",")
    .map((s) => norm(s))
    .filter(Boolean);

  const issue = await getIssueProjectItems(token, usIssueNodeId, "check-us-needs-reopen");

  const issueTypeName = issue.issueType?.name ?? "";
  if (norm(issueTypeName) !== norm(wantedUsType)) {
    console.log(`Issue is not a User Story. Found issue type: "${issueTypeName}"`);
    appendOutputs({
      should_reopen: "false",
      current_status: "",
    });
    process.exit(0);
  }

  const matchingProjectItem = (issue.projectItems?.nodes ?? []).find((item) => {
    const project = item?.project;
    if (!project || project.__typename !== "ProjectV2") return false;

    const projectOwnerLogin = project.owner?.login ?? "";
    return norm(projectOwnerLogin) === norm(org) && project.number === projectNumber;
  });

  if (!matchingProjectItem) {
    console.log(`US not found in Project V2 org=${org} number=${projectNumber}`);
    appendOutputs({
      should_reopen: "false",
      current_status: "",
    });
    process.exit(0);
  }

  const statusValue = (matchingProjectItem.fieldValues?.nodes ?? []).find(
    (fv) =>
      fv.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
      norm(fv.field?.name) === "status"
  );

  const currentStatus = statusValue?.name ?? "";
  const shouldReopen = completedStatuses.includes(norm(currentStatus));

  console.log(`US current status: ${currentStatus || "(empty)"}`);
  console.log(`Should reopen: ${shouldReopen}`);

  appendOutputs({
    should_reopen: shouldReopen ? "true" : "false",
    current_status: currentStatus,
  });
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
