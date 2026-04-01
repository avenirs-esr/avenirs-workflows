const { reqEnv, norm, appendOutput } = require("../_shared/utils");
const {
  gql,
  findProjectSingleSelectField,
  findSingleSelectOption,
  findSingleSelectFieldValue,
} = require("../_shared/github");

(async () => {
  appendOutput("should_run", "false");

  const token = reqEnv("TOKEN");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));

  const statusFieldName = "Status";
  const targetStatusName = (process.env.TARGET_STATUS_NAME || "In Review").trim();
  const wantedUsType = (process.env.US_ISSUE_TYPE || "User Story").trim();

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
                options { id name }
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
                  state
                  issueType { name }
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
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;

  let after = null;
  let project = null;
  let statusFieldId = null;
  let matchingCount = 0;

  do {
    const data = await gql(token, query, { org, number: projectNumber, after }, {
      userAgent: "should-run-if-us-in-column",
    });

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
      if (norm(issueTypeName, { stripEmoji: true }) !== norm(wantedUsType, { stripEmoji: true })) {
        continue;
      }

      const statusValue = findSingleSelectFieldValue(item.fieldValues?.nodes ?? [], statusFieldId);
      const currentStatus = statusValue?.name ?? "";

      if (norm(currentStatus, { stripEmoji: true }) === norm(targetStatusName, { stripEmoji: true })) {
        matchingCount++;
      }
    }

    after = project.items?.pageInfo?.hasNextPage
      ? project.items.pageInfo.endCursor
      : null;
  } while (after);

  appendOutput("should_run", matchingCount > 0 ? "true" : "false");

  console.log(
    `✅ Found ${matchingCount} "${wantedUsType}" issue(s) in "${targetStatusName}" (Project #${projectNumber}, field "${statusFieldName}").`
  );
})().catch((error) => {
  console.error("❌ Error:", error);
  appendOutput("should_run", "false");
  process.exit(1);
});
