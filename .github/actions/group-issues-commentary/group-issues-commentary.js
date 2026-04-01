const { reqEnv, norm } = require("../_shared/utils");
const {
  gql,
  restPost,
  findProjectSingleSelectField,
  findSingleSelectOption,
  findSingleSelectFieldValue,
} = require("../_shared/github");

(async () => {
  const token = reqEnv("TOKEN");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));
  const fromStatusName = reqEnv("FROM_STATUS_NAME").trim();
  const body = reqEnv("BODY");
  const wantedUsType = (process.env.US_ISSUE_TYPE || "User Story").trim();
  const statusFieldName = "Status";

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
                  number
                  issueType { name }
                  repository { name owner { login } }
                }
              }
              fieldValues(first: 50) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { id name } }
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
  let statusFieldId = null;
  const targets = [];

  do {
    const data = await gql(token, query, { org, number: projectNumber, after }, {
      userAgent: "comment-us-in-column",
    });

    const project = data?.organization?.projectV2;
    if (!project?.id) {
      throw new Error(`ProjectV2 not found or inaccessible: org=${org} number=${projectNumber}`);
    }

    if (!statusFieldId) {
      const statusField = findProjectSingleSelectField(project.fields?.nodes ?? [], statusFieldName, {
        stripEmoji: true,
      });

      if (!statusField?.id) {
        throw new Error(`Single-select field "${statusFieldName}" not found in Project #${projectNumber}`);
      }

      const fromStatusOption = findSingleSelectOption(statusField, fromStatusName, {
        stripEmoji: true,
      });

      if (!fromStatusOption?.id) {
        throw new Error(`Option "${fromStatusName}" not found in field "${statusFieldName}"`);
      }

      statusFieldId = statusField.id;
    }

    const items = project.items?.nodes ?? [];
    for (const item of items) {
      const issue = item?.content;
      if (!issue || issue.__typename !== "Issue") continue;

      if (norm(issue.issueType?.name, { stripEmoji: true }) !== norm(wantedUsType, { stripEmoji: true })) {
        continue;
      }

      const statusValue = findSingleSelectFieldValue(item.fieldValues?.nodes ?? [], statusFieldId);
      if (norm(statusValue?.name ?? "", { stripEmoji: true }) !== norm(fromStatusName, { stripEmoji: true })) {
        continue;
      }

      const owner = issue.repository?.owner?.login;
      const repo = issue.repository?.name;
      const number = issue.number;

      if (owner && repo && number) {
        targets.push({ owner, repo, number });
      }
    }

    after = project.items?.pageInfo?.hasNextPage
      ? project.items.pageInfo.endCursor
      : null;
  } while (after);

  const uniq = new Map();
  for (const target of targets) {
    uniq.set(`${target.owner}/${target.repo}#${target.number}`, target);
  }

  let ok = 0;
  for (const target of uniq.values()) {
    try {
      await restPost(
        token,
        `https://api.github.com/repos/${target.owner}/${target.repo}/issues/${target.number}/comments`,
        { body },
        { userAgent: "comment-us-in-column" }
      );
      ok++;
      console.log(`✅ Commented ${target.owner}/${target.repo}#${target.number}`);
    } catch (error) {
      console.error(`❌ Failed to comment ${target.owner}/${target.repo}#${target.number}:`, error?.message ?? error);
    }
  }

  console.log(`Done. Commented: ${ok}/${uniq.size}`);
})().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
