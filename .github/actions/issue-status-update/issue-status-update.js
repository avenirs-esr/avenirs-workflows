const { reqEnv, norm, logOutput } = require("../_shared/utils");
const {
  gql,
  findProjectSingleSelectField,
  findSingleSelectOption,
} = require("../_shared/github");

(async () => {
  logOutput("moved", "false");

  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));
  const targetStatusName = (process.env.TARGET_STATUS_NAME || "").trim();
  const statusFieldName = "Status";

  if (!targetStatusName) {
    throw new Error("Missing TARGET_STATUS_NAME.");
  }

  const qProject = `
    query($org: String!, $number: Int!) {
      organization(login: $org) {
        projectV2(number: $number) {
          id
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
    userAgent: "issue-status-update",
  });

  const project = projectData?.organization?.projectV2;
  if (!project?.id) {
    throw new Error(`Project V2 #${projectNumber} not found or inaccessible for org ${org}.`);
  }

  const statusField = findProjectSingleSelectField(project.fields?.nodes ?? [], statusFieldName, {
    stripEmoji: true,
  });
  if (!statusField?.id) {
    throw new Error(`Single-select field "${statusFieldName}" not found in project.`);
  }

  const targetOption = findSingleSelectOption(statusField, targetStatusName, {
    stripEmoji: true,
  });
  if (!targetOption?.id) {
    throw new Error(`Option "${targetStatusName}" not found in field "${statusFieldName}".`);
  }

  const qItems = `
    query($issueId: ID!) {
      node(id: $issueId) {
        ... on Issue {
          number
          projectItems(first: 50) {
            nodes {
              id
              project { ... on ProjectV2 { number } }
            }
          }
        }
      }
    }
  `;

  const itemsData = await gql(token, qItems, { issueId: issueNodeId }, {
    userAgent: "issue-status-update",
  });

  const issueNode = itemsData?.node;
  const items = issueNode?.projectItems?.nodes || [];
  const item = items.find((projectItem) => projectItem?.project?.number === projectNumber);

  if (!item?.id) {
    console.log(`ℹ️ Issue not linked to Project V2 #${projectNumber} -> nothing to move.`);
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

  await gql(token, mUpdate, {
    projectId: project.id,
    itemId: item.id,
    fieldId: statusField.id,
    optionId: targetOption.id,
  }, {
    userAgent: "issue-status-update",
  });

  console.log(`✅ Moved issue #${issueNode?.number ?? "?"} to "${targetStatusName}"`);
  logOutput("moved", "true");
})().catch((error) => {
  console.error("❌ Error:", error);
  logOutput("moved", "false");
  process.exit(1);
});
