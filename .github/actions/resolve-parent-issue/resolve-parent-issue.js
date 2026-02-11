const fs = require("fs");

function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value ?? ""}\n`);
}

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "resolve-parent-issue",
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
  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");

  setOutput("parent_issue_node_id", "");
  setOutput("parent_issue_number", "");
  setOutput("resolved_issue_node_id", issueNodeId);

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

  const data = await gql(token, query, { id: issueNodeId });
  const issue = data?.node;

  if (!issue?.id) {
    throw new Error("Could not resolve the given node_id to an Issue.");
  }

  const parent = issue?.parent;

  if (parent?.id) {
    setOutput("parent_issue_node_id", parent.id);
    setOutput("parent_issue_number", String(parent.number ?? ""));
    console.log(`✅ Parent found: #${parent.number} (${parent.id})`);
  } else {
    console.log("ℹ️ No parent found (issue is not a sub-issue).");
  }
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
