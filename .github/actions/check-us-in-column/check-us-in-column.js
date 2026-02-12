const fs = require("fs");

function appendOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function norm(s) {
  return String(s ?? "")
    .replace(/\p{Extended_Pictographic}/gu, "") // ignore emojis like 🏁
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
      "User-Agent": "should-run-if-us-in-column",
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
  let project = null;
  let statusFieldId = null;
  let targetOptionNameNorm = norm(targetStatusName);
  let statusFieldNameNorm = norm(statusFieldName);

  let matchingCount = 0;

  do {
    const data = await gql(token, query, { org, number: projectNumber, after });
    project = data?.organization?.projectV2;
    if (!project?.id) {
      throw new Error(`ProjectV2 not found or inaccessible: org=${org} number=${projectNumber}`);
    }

    if (!statusFieldId) {
      const fields = project.fields?.nodes ?? [];
      const statusField = fields.find(
        (f) =>
          f.__typename === "ProjectV2SingleSelectField" &&
          norm(f.name) === statusFieldNameNorm
      );

      if (!statusField?.id) {
        throw new Error(`Single-select field "${statusFieldName}" not found in Project V2 #${projectNumber}.`);
      }
      statusFieldId = statusField.id;

      const hasOption = (statusField.options ?? []).some((o) => norm(o.name) === targetOptionNameNorm);
      if (!hasOption) {
        throw new Error(`Option "${targetStatusName}" not found in field "${statusFieldName}".`);
      }
    }

    const items = project.items?.nodes ?? [];
    for (const item of items) {
      const issue = item?.content;
      if (!issue || issue.__typename !== "Issue") continue;

      const issueTypeName = issue.issueType?.name ?? "";
      if (norm(issueTypeName) !== norm(wantedUsType)) continue;

      const fvs = item.fieldValues?.nodes ?? [];
      const statusValue = fvs.find(
        (fv) =>
          fv.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
          fv.field?.id === statusFieldId
      );

      const currentStatus = statusValue?.name ?? "";
      if (norm(currentStatus) === targetOptionNameNorm) {
        matchingCount++;
      }
    }

    after = project.items?.pageInfo?.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (after);

  appendOutput("should_run", matchingCount > 0 ? "true" : "false");

  console.log(
    `✅ Found ${matchingCount} "${wantedUsType}" issue(s) in "${targetStatusName}" (Project #${projectNumber}, field "${statusFieldName}").`
  );
})().catch((e) => {
  console.error("❌ Error:", e);
  appendOutput("should_run", "false");
  process.exit(1);
});
