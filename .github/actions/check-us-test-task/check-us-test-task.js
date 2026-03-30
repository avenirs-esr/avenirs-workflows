function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "check-us-test-task",
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

async function hasTestSubTask(token, parentIssueNodeId) {
  let after = null;

  const query = `
    query($parentIssueNodeId: ID!, $after: String) {
      node(id: $parentIssueNodeId) {
        __typename
        ... on Issue {
          id
          title
          subIssues(first: 100, after: $after) {
            nodes {
              id
              title
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  do {
    const data = await gql(token, query, { parentIssueNodeId, after });
    const parent = data?.node;

    if (!parent || parent.__typename !== "Issue") {
      throw new Error(`Parent node ${parentIssueNodeId} is not an Issue`);
    }

    const subIssues = parent.subIssues?.nodes ?? [];
    const found = subIssues.some((subIssue) => norm(subIssue.title).includes("[test]"));
    if (found) {
      return { found: true, title: parent.title };
    }

    after = parent.subIssues?.pageInfo?.hasNextPage
      ? parent.subIssues.pageInfo.endCursor
      : null;
  } while (after);

  const finalData = await gql(token, `
    query($parentIssueNodeId: ID!) {
      node(id: $parentIssueNodeId) {
        __typename
        ... on Issue {
          title
        }
      }
    }
  `, { parentIssueNodeId });

  return {
    found: false,
    title: finalData?.node?.title ?? "unknown",
  };
}

(async () => {
  const token = reqEnv("TOKEN");
  const parentIssueNodeId = reqEnv("PARENT_ISSUE_NODE_ID");
  const githubOutput = process.env.GITHUB_OUTPUT;

  const result = await hasTestSubTask(token, parentIssueNodeId);

  console.log(`Parent issue: ${result.title} (${parentIssueNodeId})`);
  console.log(`Has [TEST] sub-task: ${result.found}`);

  if (githubOutput) {
    const fs = await import("node:fs");
    fs.appendFileSync(githubOutput, `test_task=${result.found ? "true" : "false"}\n`);
  }
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
