const { reqEnv, appendOutputs } = require("../_shared/utils");
const { gql } = require("../_shared/github");

(async () => {
  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");

  appendOutputs({
    parent_issue_node_id: "",
    parent_issue_number: "",
    resolved_issue_node_id: issueNodeId,
  });

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on Issue {
          id
          number
          parent {
            ... on Issue {
              id
              number
            }
          }
        }
      }
    }
  `;

  const data = await gql(token, query, { id: issueNodeId }, {
    userAgent: "resolve-parent-issue",
    extraHeaders: {
      "GraphQL-Features": "sub_issues",
    },
  });

  const issue = data?.node;
  if (!issue?.id) {
    throw new Error("Could not resolve the given node_id to an Issue.");
  }

  const parent = issue.parent;

  if (parent?.id) {
    appendOutputs({
      parent_issue_node_id: parent.id,
      parent_issue_number: String(parent.number ?? ""),
    });
    console.log(`✅ Parent found: #${parent.number} (${parent.id})`);
  } else {
    console.log("ℹ️ No parent found (issue is not a sub-issue).");
  }
})().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
