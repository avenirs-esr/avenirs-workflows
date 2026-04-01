const { reqEnv, norm } = require("../_shared/utils");
const {
  gql,
  findProjectSingleSelectField,
  findSingleSelectOption,
  findSingleSelectFieldValue,
} = require("../_shared/github");

(async () => {
  const token = reqEnv("TOKEN");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));

  const statusFieldName = "Status";
  const fromStatusName = (process.env.FROM_STATUS_NAME || "In Review").trim();
  const targetStatusName = (process.env.TARGET_STATUS_NAME || "Recette").trim();
  const wantedUsType = (process.env.US_ISSUE_TYPE || "User Story").trim();

  const qProject = `
    query($org: String!, $number: Int!) {
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
        }
      }
    }
  `;

  const projectData = await gql(token, qProject, { org, number: projectNumber }, {
    userAgent: "bulk-move-us-status",
  });

  const project = projectData?.organization?.projectV2;
  if (!project?.id) {
    throw new Error(`ProjectV2 not found or inaccessible: ${org} #${projectNumber}`);
  }

  const statusField = findProjectSingleSelectField(project.fields?.nodes ?? [], statusFieldName, {
    stripEmoji: true,
  });
  if (!statusField?.id) {
    throw new Error(`Single-select field "${statusFieldName}" not found in ProjectV2 #${projectNumber}`);
  }

  const fromOption = findSingleSelectOption(statusField, fromStatusName, {
    stripEmoji: true,
  });
  const targetOption = findSingleSelectOption(statusField, targetStatusName, {
    stripEmoji: true,
  });

  if (!fromOption?.id) {
    throw new Error(`Option "${fromStatusName}" not found in field "${statusFieldName}"`);
  }
  if (!targetOption?.id) {
    throw new Error(`Option "${targetStatusName}" not found in field "${statusFieldName}"`);
  }

  const qItems = `
    query($org: String!, $number: Int!, $after: String) {
      organization(login: $org) {
        projectV2(number: $number) {
          items(first: 100, after: $after) {
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  id
                  number
                  title
                  issueType { name }
                }
              }
              fieldValues(first: 30) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { id } }
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

  const toMove = [];
  let after = null;

  do {
    const data = await gql(token, qItems, { org, number: projectNumber, after }, {
      userAgent: "bulk-move-us-status",
    });

    const items = data?.organization?.projectV2?.items;
    if (!items) {
      throw new Error("Unable to fetch project items.");
    }

    for (const node of items.nodes ?? []) {
      const issue = node?.content;
      if (!issue || issue.__typename !== "Issue") continue;

      if (norm(issue.issueType?.name, { stripEmoji: true }) !== norm(wantedUsType, { stripEmoji: true })) {
        continue;
      }

      const statusValue = findSingleSelectFieldValue(node.fieldValues?.nodes ?? [], statusField.id);
      if (norm(statusValue?.name ?? "", { stripEmoji: true }) !== norm(fromStatusName, { stripEmoji: true })) {
        continue;
      }

      toMove.push({
        itemId: node.id,
        issueNumber: issue.number,
        title: issue.title,
      });
    }

    after = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
  } while (after);

  if (toMove.length === 0) {
    console.log(`ℹ️ No "${wantedUsType}" in "${fromStatusName}" to move.`);
    return;
  }

  const mUpdate = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
  `;

  let movedCount = 0;
  for (const item of toMove) {
    await gql(token, mUpdate, {
      projectId: project.id,
      itemId: item.itemId,
      fieldId: statusField.id,
      optionId: targetOption.id,
    }, {
      userAgent: "bulk-move-us-status",
    });

    movedCount++;
    console.log(`✅ Moved US #${item.issueNumber} -> "${targetStatusName}"`);
  }
})().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
