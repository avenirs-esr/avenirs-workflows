function norm(s) {
  return String(s ?? "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .toLowerCase()
    .trim();
}

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
      "User-Agent": "bulk-move-us-status",
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

  const projectData = await gql(token, qProject, { org, number: projectNumber });
  const project = projectData?.organization?.projectV2;
  if (!project?.id) throw new Error(`ProjectV2 not found or inaccessible: ${org} #${projectNumber}`);

  const statusField = (project.fields?.nodes ?? []).find(
    (f) => f.__typename === "ProjectV2SingleSelectField" && norm(f.name) === norm(statusFieldName)
  );
  if (!statusField?.id) throw new Error(`Single-select field "${statusFieldName}" not found in ProjectV2 #${projectNumber}`);

  const fromOpt = (statusField.options ?? []).find((o) => norm(o.name) === norm(fromStatusName));
  const targetOpt = (statusField.options ?? []).find((o) => norm(o.name) === norm(targetStatusName));

  if (!fromOpt?.id) throw new Error(`Option "${fromStatusName}" not found in field "${statusFieldName}"`);
  if (!targetOpt?.id) throw new Error(`Option "${targetStatusName}" not found in field "${statusFieldName}"`);

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
    const data = await gql(token, qItems, { org, number: projectNumber, after });
    const items = data?.organization?.projectV2?.items;
    if (!items) throw new Error("Unable to fetch project items.");

    for (const node of items.nodes ?? []) {
      const issue = node?.content;
      if (!issue || issue.__typename !== "Issue") continue;

      if (norm(issue.issueType?.name) !== norm(wantedUsType)) continue;

      const statusValue = (node.fieldValues?.nodes ?? []).find(
        (fv) =>
          fv.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
          fv.field?.id === statusField.id
      );

      const currentStatus = statusValue?.name ?? "";
      if (norm(currentStatus) !== norm(fromStatusName)) continue;

      toMove.push({ itemId: node.id, issueNumber: issue.number, title: issue.title });
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
  for (const it of toMove) {
    await gql(token, mUpdate, {
      projectId: project.id,
      itemId: it.itemId,
      fieldId: statusField.id,
      optionId: targetOpt.id,
    });
    movedCount++;
    console.log(`✅ Moved US #${it.issueNumber} -> "${targetStatusName}"`);
  }
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
