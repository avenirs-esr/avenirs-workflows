function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function norm(s) {
  return String(s ?? "")
    .replace(/\p{Extended_Pictographic}/gu, "") // ignore emojis like 🏁
    .toLowerCase()
    .trim();
}

async function gql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "check-us-needs-reopen",
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

async function writeOutputs(outputs) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) return;

  const fs = await import("node:fs");
  for (const [key, value] of Object.entries(outputs)) {
    fs.appendFileSync(githubOutput, `${key}=${value}\n`);
  }
}

(async () => {
  const token = reqEnv("TOKEN");
  const usIssueNodeId = reqEnv("US_ISSUE_NODE_ID");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));
  const wantedUsType = reqEnv("US_ISSUE_TYPE");
  const completedStatuses = reqEnv("COMPLETED_STATUS_NAMES")
    .split(",")
    .map((s) => norm(s))
    .filter(Boolean);

  const query = `
    query($issueNodeId: ID!) {
      node(id: $issueNodeId) {
        __typename
        ... on Issue {
          id
          title
          issueType {
            name
          }
          projectItems(first: 20) {
            nodes {
              id
              project {
                __typename
                ... on ProjectV2 {
                  id
                  number
                  title
                  owner {
                    __typename
                    ... on Organization {
                      login
                    }
                    ... on User {
                      login
                    }
                  }
                }
              }
              fieldValues(first: 50) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      __typename
                      ... on ProjectV2SingleSelectField {
                        id
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

  const data = await gql(token, query, { issueNodeId: usIssueNodeId });

  const issue = data?.node;
  if (!issue || issue.__typename !== "Issue") {
    throw new Error(`Node ${usIssueNodeId} is not an Issue`);
  }

  const issueTypeName = issue.issueType?.name ?? "";
  if (norm(issueTypeName) !== norm(wantedUsType)) {
    console.log(`Issue is not a User Story. Found issue type: "${issueTypeName}"`);
    await writeOutputs({
      should_reopen: "false",
      current_status: "",
    });
    process.exit(0);
  }

  const matchingProjectItem = (issue.projectItems?.nodes ?? []).find((item) => {
    const project = item?.project;
    if (!project || project.__typename !== "ProjectV2") return false;

    const projectOwnerLogin = project.owner?.login ?? "";
    return norm(projectOwnerLogin) === norm(org) && project.number === projectNumber;
  });

  if (!matchingProjectItem) {
    console.log(`US not found in Project V2 org=${org} number=${projectNumber}`);
    await writeOutputs({
      should_reopen: "false",
      current_status: "",
    });
    process.exit(0);
  }

  const statusValue = (matchingProjectItem.fieldValues?.nodes ?? []).find(
    (fv) =>
      fv.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
      norm(fv.field?.name) === "status"
  );

  const currentStatus = statusValue?.name ?? "";
  const shouldReopen = completedStatuses.includes(norm(currentStatus));

  console.log(`US current status: ${currentStatus || "(empty)"}`);
  console.log(`Should reopen: ${shouldReopen}`);

  await writeOutputs({
    should_reopen: shouldReopen ? "true" : "false",
    current_status: currentStatus,
  });
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
