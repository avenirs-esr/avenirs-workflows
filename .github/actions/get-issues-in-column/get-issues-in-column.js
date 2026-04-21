const { reqEnv, norm, appendOutputs } = require("../_shared/utils");
const {
  gql,
  findProjectSingleSelectField,
  findSingleSelectOption,
  findSingleSelectFieldValue,
} = require("../_shared/github");

(async () => {
  appendOutputs({
    should_run: "false",
    count: "0",
    issues_json: "[]",
  });

  const token = reqEnv("TOKEN");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));

  const statusFieldName = "Status";
  const targetStatusName = (process.env.TARGET_STATUS_NAME || "In Review").trim();
  const wantedIssueType = (process.env.ISSUE_TYPE || "User Story").trim();

  const query = `
    query($org: String!, $number: Int!, $after: String) {
      organization(login: $org) {
        projectV2(number: $number) {
          id
          title
          fields(first: 100) {
            nodes {
              __typename
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
          items(first: 100, after: $after) {
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  id
                  number
                  title
                  url
                  state
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
                }
              }
              fieldValues(first: 30) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                      }
                    }
                  }
                }
              }
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

  let after = null;
  let project = null;
  let statusFieldId = null;
  const matchingIssues = [];

  do {
    const data = await gql(
      token,
      query,
      { org, number: projectNumber, after },
      { userAgent: "get-issues-in-column" }
    );

    project = data?.organization?.projectV2;
    if (!project?.id) {
      throw new Error(`ProjectV2 not found or inaccessible: org=${org} number=${projectNumber}`);
    }

    if (!statusFieldId) {
      const fields = project.fields?.nodes ?? [];

      const statusField = findProjectSingleSelectField(fields, statusFieldName, {
        stripEmoji: true,
      });

      if (!statusField?.id) {
        throw new Error(`Single-select field "${statusFieldName}" not found in Project V2 #${projectNumber}.`);
      }

      const targetOption = findSingleSelectOption(statusField, targetStatusName, {
        stripEmoji: true,
      });

      if (!targetOption?.id) {
        throw new Error(`Option "${targetStatusName}" not found in field "${statusFieldName}".`);
      }

      statusFieldId = statusField.id;
    }

    const items = project.items?.nodes ?? [];

    for (const item of items) {
      const issue = item?.content;
      if (!issue || issue.__typename !== "Issue") continue;

      const issueTypeName = issue.issueType?.name ?? "";
      if (norm(issueTypeName, { stripEmoji: true }) !== norm(wantedIssueType, { stripEmoji: true })) {
        continue;
      }

      const statusValue = findSingleSelectFieldValue(item.fieldValues?.nodes ?? [], statusFieldId);
      const currentStatus = statusValue?.name ?? "";

      if (norm(currentStatus, { stripEmoji: true }) !== norm(targetStatusName, { stripEmoji: true })) {
        continue;
      }

      matchingIssues.push({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        author: issue.author?.login ?? "unknown",
        state: issue.state ?? "",
        issue_type: issue.issueType?.name ?? "",
        labels: (issue.labels?.nodes ?? []).map(label => label.name),
      });
    }

    after = project.items?.pageInfo?.hasNextPage
      ? project.items.pageInfo.endCursor
      : null;
  } while (after);

  appendOutputs({
    should_run: matchingIssues.length > 0 ? "true" : "false",
    count: String(matchingIssues.length),
    issues_json: JSON.stringify(matchingIssues),
  });

  console.log(
    `✅ Found ${matchingIssues.length} "${wantedIssueType}" issue(s) in "${targetStatusName}" (Project #${projectNumber}).`
  );
})().catch((error) => {
  console.error("❌ Error:", error);
  appendOutputs({
    should_run: "false",
    count: "0",
    issues_json: "[]",
  });
  process.exit(1);
});
