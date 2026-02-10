const fs = require("fs");

function out(key, value) {
  console.log(`${key}=${value}`);
}

function normalizeName(s) {
  return String(s || "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .toLowerCase()
    .trim();
}

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "issue-status-update",
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

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

(async () => {
  out("moved", "false");

  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));
  const statusFieldName = (process.env.STATUS_FIELD_NAME || "Status").trim();
  const targetStatusName = (process.env.TARGET_STATUS_NAME || "").trim();

  if (!targetStatusName) throw new Error("Missing TARGET_STATUS_NAME.");

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

  const projectData = await gql(token, qProject, { org, number: projectNumber });
  const project = projectData?.organization?.projectV2;
  if (!project?.id) throw new Error(`Project V2 #${projectNumber} not found or inaccessible for org ${org}.`);

  const statusField = (project.fields?.nodes || []).find(
    (f) =>
      f.__typename === "ProjectV2SingleSelectField" &&
      normalizeName(f.name) === normalizeName(statusFieldName)
  );
  if (!statusField?.id) throw new Error(`Single-select field "${statusFieldName}" not found in project.`);

  const targetOption = (statusField.options || []).find(
    (o) => normalizeName(o.name) === normalizeName(targetStatusName)
  );
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

  const itemsData = await gql(token, qItems, { issueId: issueNodeId });
  const issueNode = itemsData?.node;
  const items = issueNode?.projectItems?.nodes || [];
  const item = items.find((i) => i?.project?.number === projectNumber);

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
  });

  console.log(`✅ Moved issue #${issueNode?.number ?? "?"} to "${targetStatusName}"`);
  out("moved", "true");
})().catch((e) => {
  console.error("❌ Error:", e);
  out("moved", "false");
  process.exit(1);
});
