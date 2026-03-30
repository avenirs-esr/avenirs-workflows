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
      "User-Agent": "comment-single-issue",
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

async function restCreateComment(token, owner, repo, issueNumber, body) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "comment-single-issue",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`REST create comment failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}

(async () => {
  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");
  const body = reqEnv("BODY");

  const query = `
    query($issueNodeId: ID!) {
      node(id: $issueNodeId) {
        __typename
        ... on Issue {
          id
          number
          repository {
            name
            owner {
              login
            }
          }
        }
      }
    }
  `;

  const data = await gql(token, query, { issueNodeId });
  const issue = data?.node;

  if (!issue || issue.__typename !== "Issue") {
    throw new Error(`Node ${issueNodeId} is not an Issue`);
  }

  const owner = issue.repository?.owner?.login;
  const repo = issue.repository?.name;
  const number = issue.number;

  if (!owner || !repo || !number) {
    throw new Error(`Unable to resolve repository or issue number for node ${issueNodeId}`);
  }

  await restCreateComment(token, owner, repo, number, body);
  console.log(`✅ Commented ${owner}/${repo}#${number}`);
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
