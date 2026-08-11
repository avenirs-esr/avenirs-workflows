const { reqEnv, norm, normList, appendOutput, appendOutputs } = require("../_shared/utils");
const { gql } = require("../_shared/github");

(async () => {
  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");
  // US_ISSUE_TYPE accepts a comma-separated list of issue types (e.g. "User Story,Enabler Story").
  // Kept as a single value by default so existing callers are unaffected.
  const wantedTypes = normList(process.env.US_ISSUE_TYPE || "User Story");

  const setFalse = (reason) => {
    if (reason) {
      console.log(`ℹ️ ${reason}`);
    }
    appendOutputs({
      should_run: "false",
      parent_issue_title: "",
      parent_issue_type: "",
    });
  };

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on Issue {
          parent {
            ... on Issue {
              title
              issueType { name }
              subIssuesSummary { total completed percentCompleted }
              subIssues(first: 100) {
                nodes {
                  ... on Issue {
                    state
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await gql(token, query, { id: issueNodeId }, {
    userAgent: "us-subissues-checker",
    extraHeaders: {
      "GraphQL-Features": "sub_issues",
    },
  });

  const parent = data?.node?.parent;

  if (!parent) {
    setFalse("Issue has no parent (not a sub-issue).");
    return;
  }

  const parentType = norm(parent?.issueType?.name || "");
  const isMatchingType = parentType && wantedTypes.includes(parentType);

  if (!isMatchingType) {
    setFalse(`Parent issueType "${parent?.issueType?.name ?? ""}" does not match any of "${wantedTypes.join(", ")}".`);
    return;
  }

  const summary = parent?.subIssuesSummary;
  let allClosed = false;

  if (summary && typeof summary.total === "number" && typeof summary.completed === "number") {
    allClosed = summary.total > 0 && summary.completed === summary.total;
  } else {
    const subIssues = parent?.subIssues?.nodes ?? [];
    allClosed = subIssues.length > 0 && subIssues.every(
      (subIssue) => String(subIssue?.state).toUpperCase() === "CLOSED"
    );
  }

  appendOutputs({
    should_run: allClosed ? "true" : "false",
    parent_issue_title: parent?.title ?? "",
    parent_issue_type: parent?.issueType?.name ?? "",
  });
})().catch((error) => {
  console.error("❌ Error:", error);
  appendOutput("should_run", "false");
  process.exit(1);
});
