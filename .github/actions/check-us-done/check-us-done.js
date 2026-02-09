const fs = require("fs");

function appendOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "us-subissues-checker",
      "GraphQL-Features": "sub_issues",
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GraphQL non-JSON response: HTTP ${res.status} ${text}`);
  }
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

(async () => {
  const token = process.env.TOKEN;
  const wantedType = norm(process.env.US_ISSUE_TYPE || "User Story");
  const issueNodeId = process.env.ISSUE_NODE_ID;

  const setFalse = (reason) => {
    if (reason) console.log(`ℹ️ ${reason}`);
    appendOutput("should_run", "false");
  };

  if (!token) {
    setFalse("Missing TOKEN.");
    process.exit(1);
  }

  if (!issueNodeId) {
    setFalse("Missing ISSUE_NODE_ID input.");
    return;
  }

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on Issue {
          parent {
            ... on Issue {
              issueType { name }
              subIssuesSummary { total completed percentCompleted }
              subIssues(first: 100) {
                nodes { ... on Issue { state } }
              }
            }
          }
        }
      }
    }
  `;

  const data = await gql(token, query, { id: issueNodeId });
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
    const subs = parent?.subIssues?.nodes ?? [];
    allClosed = subs.length > 0 && subs.every((s) => String(s?.state).toUpperCase() === "CLOSED");
  }

  appendOutput("should_run", allClosed ? "true" : "false");
})().catch((e) => {
  console.error("❌ Error:", e);
  appendOutput("should_run", "false");
  process.exit(1);
});
