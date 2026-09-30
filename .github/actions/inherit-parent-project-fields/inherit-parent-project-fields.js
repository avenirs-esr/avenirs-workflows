const {
  reqEnv,
  norm,
  appendOutputs,
  findProjectIterationField,
  findIterationFieldValue,
} = require("../_shared/utils");
const {
  gql,
  findProjectSingleSelectField,
  findSingleSelectFieldValue,
} = require("../_shared/github");

const USER_AGENT = "inherit-parent-project-fields";
const SUB_ISSUES_HEADERS = { "GraphQL-Features": "sub_issues" };

const Q_PROJECT = `
  query ProjectFields($org: String!, $number: Int!) {
    organization(login: $org) {
      projectV2(number: $number) {
        id
        fields(first: 100) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id
              name
            }
            ... on ProjectV2IterationField {
              id
              name
            }
          }
        }
      }
    }
  }
`;

const Q_ISSUE = `
  query IssueProjectItems($issueId: ID!) {
    node(id: $issueId) {
      __typename
      ... on Issue {
        id
        number
        parent {
          ... on Issue {
            id
            number
          }
        }
        projectItems(first: 50) {
          nodes {
            id
            project {
              ... on ProjectV2 {
                number
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
                  optionId
                  name
                  field {
                    ... on ProjectV2SingleSelectField {
                      id
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  iterationId
                  title
                  field {
                    ... on ProjectV2IterationField {
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

const M_ADD_ITEM = `
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

const M_UPDATE_FIELD = `
  mutation UpdateField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: $value
    }) {
      projectV2Item { id }
    }
  }
`;

function parseFieldNames(value) {
  return String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function isTrue(value) {
  return norm(value) === "true";
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function fetchIssue(token, issueNodeId) {
  const data = await gql(token, Q_ISSUE, { issueId: issueNodeId }, {
    userAgent: USER_AGENT,
    extraHeaders: SUB_ISSUES_HEADERS,
  });

  const issue = data?.node;
  if (!issue || issue.__typename !== "Issue") {
    throw new Error(`Node ${issueNodeId} could not be resolved to an Issue.`);
  }

  return issue;
}

/**
 * A sub-issue is often linked to its parent right AFTER the `issues.opened`
 * event is emitted, so the parent may not be visible on the first lookup.
 */
async function fetchIssueWithParent(token, issueNodeId, attempts, delaySeconds) {
  let issue = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    issue = await fetchIssue(token, issueNodeId);

    if (issue.parent?.id) {
      return issue;
    }

    if (attempt < attempts) {
      console.log(`⏳ No parent yet (attempt ${attempt}/${attempts}), retrying in ${delaySeconds}s...`);
      await sleep(delaySeconds);
    }
  }

  return issue;
}

function findProjectItem(issue, org, projectNumber) {
  return (issue.projectItems?.nodes ?? []).find((item) => {
    const project = item?.project;
    if (!project) return false;

    return project.number === projectNumber
      && norm(project.owner?.login ?? "") === norm(org);
  });
}

function resolveTargetFields(projectFields, fieldNames) {
  const targetFields = [];

  for (const fieldName of fieldNames) {
    const singleSelectField = findProjectSingleSelectField(projectFields, fieldName, {
      stripEmoji: true,
    });

    if (singleSelectField?.id) {
      targetFields.push({ name: fieldName, id: singleSelectField.id, type: "singleSelect" });
      continue;
    }

    const iterationField = findProjectIterationField(projectFields, fieldName, {
      stripEmoji: true,
    });

    if (iterationField?.id) {
      targetFields.push({ name: fieldName, id: iterationField.id, type: "iteration" });
      continue;
    }

    console.log(`⚠️ Field "${fieldName}" is not a single-select nor an iteration field of the project -> ignored.`);
  }

  return targetFields;
}

function readFieldValue(item, field) {
  if (field.type === "singleSelect") {
    const fieldValue = findSingleSelectFieldValue(item.fieldValues?.nodes ?? [], field.id);

    return fieldValue?.optionId
      ? { label: fieldValue.name ?? "", value: { singleSelectOptionId: fieldValue.optionId } }
      : null;
  }

  const fieldValue = findIterationFieldValue(item.fieldValues?.nodes ?? [], field.name, {
    stripEmoji: true,
  });

  return fieldValue?.iterationId
    ? { label: fieldValue.title ?? "", value: { iterationId: fieldValue.iterationId } }
    : null;
}

(async () => {
  appendOutputs({
    inherited: "false",
    parent_issue_number: "",
    updated_fields: "",
  });

  const token = reqEnv("TOKEN");
  const issueNodeId = reqEnv("ISSUE_NODE_ID");
  const org = reqEnv("ORG");
  const projectNumber = Number(reqEnv("PROJECT_NUMBER"));
  const fieldNames = parseFieldNames(reqEnv("FIELD_NAMES"));
  const overwrite = isTrue(process.env.OVERWRITE);
  const addToProjectIfMissing = isTrue(process.env.ADD_TO_PROJECT_IF_MISSING);
  const parentLookupAttempts = toPositiveInt(process.env.PARENT_LOOKUP_ATTEMPTS, 3);
  const parentLookupDelay = toPositiveInt(process.env.PARENT_LOOKUP_DELAY_SECONDS, 5);

  if (!Number.isInteger(projectNumber) || projectNumber <= 0) {
    throw new Error(`Invalid PROJECT_NUMBER "${process.env.PROJECT_NUMBER}".`);
  }

  if (fieldNames.length === 0) {
    throw new Error("Missing FIELD_NAMES: nothing to inherit.");
  }

  const issue = await fetchIssueWithParent(
    token,
    issueNodeId,
    parentLookupAttempts,
    parentLookupDelay
  );

  if (!issue.parent?.id) {
    console.log("ℹ️ Issue is not a sub-issue (no parent) -> nothing to inherit.");
    return;
  }

  console.log(`🔎 Sub-issue #${issue.number} -> parent #${issue.parent.number}`);
  appendOutputs({ parent_issue_number: String(issue.parent.number ?? "") });

  const projectData = await gql(token, Q_PROJECT, { org, number: projectNumber }, {
    userAgent: USER_AGENT,
  });

  const project = projectData?.organization?.projectV2;
  if (!project?.id) {
    throw new Error(`Project V2 #${projectNumber} not found or inaccessible for org ${org}.`);
  }

  const targetFields = resolveTargetFields(project.fields?.nodes ?? [], fieldNames);
  if (targetFields.length === 0) {
    throw new Error(`None of the requested fields (${fieldNames.join(", ")}) exist in Project V2 #${projectNumber}.`);
  }

  const parentIssue = await fetchIssue(token, issue.parent.id);
  const parentItem = findProjectItem(parentIssue, org, projectNumber);

  if (!parentItem?.id) {
    console.log(`ℹ️ Parent #${parentIssue.number} is not in Project V2 #${projectNumber} -> nothing to inherit.`);
    return;
  }

  const inheritable = targetFields
    .map((field) => ({ field, parentValue: readFieldValue(parentItem, field) }))
    .filter((entry) => {
      if (!entry.parentValue) {
        console.log(`ℹ️ Parent has no value for "${entry.field.name}" -> skipped.`);
        return false;
      }
      return true;
    });

  if (inheritable.length === 0) {
    console.log("ℹ️ Parent has no value to inherit -> nothing to do.");
    return;
  }

  let childItem = findProjectItem(issue, org, projectNumber);

  if (!childItem?.id) {
    if (!addToProjectIfMissing) {
      console.log(`ℹ️ Sub-issue #${issue.number} is not in Project V2 #${projectNumber} -> nothing to do.`);
      return;
    }

    const added = await gql(token, M_ADD_ITEM, {
      projectId: project.id,
      contentId: issue.id,
    }, {
      userAgent: USER_AGENT,
    });

    const addedItemId = added?.addProjectV2ItemById?.item?.id;
    if (!addedItemId) {
      throw new Error(`Could not add sub-issue #${issue.number} to Project V2 #${projectNumber}.`);
    }

    console.log(`➕ Sub-issue #${issue.number} added to Project V2 #${projectNumber}.`);
    childItem = { id: addedItemId, fieldValues: { nodes: [] } };
  }

  const updatedFields = [];

  for (const { field, parentValue } of inheritable) {
    const currentValue = readFieldValue(childItem, field);

    if (currentValue && !overwrite) {
      console.log(`⏭️ "${field.name}" already set to "${currentValue.label}" on the sub-issue -> kept (overwrite=false).`);
      continue;
    }

    await gql(token, M_UPDATE_FIELD, {
      projectId: project.id,
      itemId: childItem.id,
      fieldId: field.id,
      value: parentValue.value,
    }, {
      userAgent: USER_AGENT,
    });

    console.log(`✅ "${field.name}" set to "${parentValue.label}" (inherited from #${parentIssue.number}).`);
    updatedFields.push(field.name);
  }

  if (updatedFields.length === 0) {
    console.log("ℹ️ No field updated.");
    return;
  }

  appendOutputs({
    inherited: "true",
    updated_fields: updatedFields.join(","),
  });
})().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
