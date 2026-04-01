const { reqEnv } = require("../_shared/utils");
const { gql, restPost } = require("../_shared/github");

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

  const data = await gql(token, query, { issueNodeId }, "comment-single-issue");
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

  await restPost(
    token,
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
    { body },
    "comment-single-issue"
  );

  console.log(`✅ Commented ${owner}/${repo}#${number}`);
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
