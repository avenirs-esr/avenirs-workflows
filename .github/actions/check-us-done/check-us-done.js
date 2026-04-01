const { reqEnv, norm, appendOutput } = require("../_shared/utils");
const { gql } = require("../_shared/github");

(async () => {
  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");
  const wantedType = norm(process.env.US_ISSUE_TYPE || "User Story");

  const setFalse = (reason) => {
    if (reason) {
      console.log(`ℹ️ ${reason}`);
    }
    appendOutput("should_run", "false");
  };

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on Issue {
          parent {
            ... on Issue {
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
  const isUserStory = parentType && parentType === wantedType;

  if (!isUserStory) {
    setFalse(`Parent issueType "${parent?.issueType?.name ?? ""}" does not match "${process.env.US_ISSUE_TYPE}".`);
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

  appendOutput("should_run", allClosed ? "true" : "false");
})().catch((error) => {
  console.error("❌ Error:", error);
  appendOutput("should_run", "false");
  process.exit(1);
});
