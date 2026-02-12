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
      "User-Agent": "comment-us-in-column",
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

async function restCreateComment(token, owner, repo, issue_number, body) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "comment-us-in-column",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`REST create comment failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

(async () => {
  const token = reqEnv("TOKEN");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));

  const statusFieldName = "Status";
  const fromStatusName = reqEnv("FROM_STATUS_NAME").trim();
  const wantedUsType = (process.env.US_ISSUE_TYPE || "User Story").trim();
  const body = reqEnv("BODY");

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

  const targetStatusNorm = norm(fromStatusName);
  const statusFieldNameNorm = norm(statusFieldName);

  const targets = [];

  do {
    const data = await gql(token, query, { org, number: projectNumber, after });
    const project = data?.organization?.projectV2;
    if (!project?.id) throw new Error(`ProjectV2 not found or inaccessible: org=${org} number=${projectNumber}`);

    if (!statusFieldId) {
      const fields = project.fields?.nodes ?? [];
      const statusField = fields.find(
        (f) => f.__typename === "ProjectV2SingleSelectField" && norm(f.name) === statusFieldNameNorm
      );
      if (!statusField?.id) throw new Error(`Single-select field "${statusFieldName}" not found in Project #${projectNumber}`);
      statusFieldId = statusField.id;

      const hasOption = (statusField.options ?? []).some((o) => norm(o.name) === targetStatusNorm);
      if (!hasOption) throw new Error(`Option "${fromStatusName}" not found in field "${statusFieldName}"`);
    }

    const items = project.items?.nodes ?? [];
    for (const item of items) {
      const issue = item?.content;
      if (!issue || issue.__typename !== "Issue") continue;

      const issueTypeName = issue.issueType?.name ?? "";
      if (norm(issueTypeName) !== norm(wantedUsType)) continue;

      const fvs = item.fieldValues?.nodes ?? [];
      const statusValue = fvs.find(
        (fv) => fv.__typename === "ProjectV2ItemFieldSingleSelectValue" && fv.field?.id === statusFieldId
      );
      const currentStatus = statusValue?.name ?? "";
      if (norm(currentStatus) !== targetStatusNorm) continue;

      const owner = issue.repository?.owner?.login;
      const repo = issue.repository?.name;
      const number = issue.number;

      if (owner && repo && number) {
        targets.push({ owner, repo, number });
      }
    }

    after = project.items?.pageInfo?.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (after);

  const uniq = new Map();
  for (const t of targets) uniq.set(`${t.owner}/${t.repo}#${t.number}`, t);

  let ok = 0;
  for (const t of uniq.values()) {
    try {
      await restCreateComment(token, t.owner, t.repo, t.number, body);
      ok++;
      console.log(`✅ Commented ${t.owner}/${t.repo}#${t.number}`);
    } catch (e) {
      console.error(`❌ Failed to comment ${t.owner}/${t.repo}#${t.number}:`, e?.message ?? e);
    }
  }

  console.log(`Done. Commented: ${ok}/${uniq.size}`);
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
