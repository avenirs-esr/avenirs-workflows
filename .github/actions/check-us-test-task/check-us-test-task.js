const { reqEnv, norm, appendOutput } = require("../_shared/utils");
const { gql } = require("../_shared/github");

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
    const data = await gql(
      token,
      query,
      { parentIssueNodeId, after },
      { userAgent: "check-us-test-task" }
    );

    const parent = data?.node;

    if (!parent || parent.__typename !== "Issue") {
      throw new Error(`Parent node ${parentIssueNodeId} is not an Issue`);
    }

    const subIssues = parent.subIssues?.nodes ?? [];
    const found = subIssues.some((subIssue) =>
      norm(subIssue.title).includes("[qualif]")
    );

    if (found) {
      return { found: true, title: parent.title };
    }

    after = parent.subIssues?.pageInfo?.hasNextPage
      ? parent.subIssues.pageInfo.endCursor
      : null;
  } while (after);

  const finalData = await gql(
    token,
    `
      query($parentIssueNodeId: ID!) {
        node(id: $parentIssueNodeId) {
          __typename
          ... on Issue {
            title
          }
        }
      }
    `,
    { parentIssueNodeId },
    { userAgent: "check-us-test-task" }
  );

  return {
    found: false,
    title: finalData?.node?.title ?? "unknown",
  };
}

(async () => {
  const token = reqEnv("TOKEN");
  const parentIssueNodeId = reqEnv("PARENT_ISSUE_NODE_ID");

  const result = await hasTestSubTask(token, parentIssueNodeId);

  console.log(`Parent issue: ${result.title} (${parentIssueNodeId})`);
  console.log(`Has [QUALIF] sub-task: ${result.found}`);

  appendOutput("test_task", result.found ? "true" : "false");
})().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
