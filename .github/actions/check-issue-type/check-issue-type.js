const { reqEnv, appendOutputs } = require("../_shared/utils");
const { gql } = require("../_shared/github");

(async () => {
  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");

  appendOutputs({
    is_bug: "false",
    issue_number: "",
    issue_title: "",
    issue_url: "",
    issue_author: "",
  });

  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on Issue {
          id
          number
          title
          url
          author {
            login
          }
          issueType {
            name
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
          projectItems(first: 10) {
            nodes {
              fieldValues(first: 20) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
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
    userAgent: "check-issue-type",
  });

  const issue = data?.node;

  if (!issue?.id) {
    throw new Error("Could not resolve node_id to Issue.");
  }

  const issueTypeName = issue.issueType?.name ?? null;
  const labels = issue.labels?.nodes?.map(l => l.name.toLowerCase()) ?? [];
  const projectItems = issue.projectItems?.nodes ?? [];

  let isBug = false;

  if (issueTypeName === "Bug") {
    console.log("🐞 Detected via native issueType");
    isBug = true;
  }

  if (!isBug && labels.includes("bug")) {
    console.log("🐞 Detected via label");
    isBug = true;
  }

  if (!isBug) {
    for (const item of projectItems) {
      const fields = item.fieldValues?.nodes ?? [];

      for (const field of fields) {
        if (
          field?.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
          field?.field?.name === "Type" &&
          field?.name === "Bug"
        ) {
          console.log("🐞 Detected via ProjectV2 Type field");
          isBug = true;
          break;
        }
      }

      if (isBug) break;
    }
  }

  appendOutputs({
    is_bug: isBug ? "true" : "false",
    issue_number: String(issue.number),
    issue_title: issue.title,
    issue_url: issue.url,
    issue_author: issue.author?.login ?? "unknown",
  });

  console.log(isBug ? "✅ Issue classified as Bug" : "ℹ️ Issue is not a Bug");
})();
