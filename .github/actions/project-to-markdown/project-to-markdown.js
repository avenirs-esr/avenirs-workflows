const {
  reqEnv,
  norm,
  ensureDir,
  writeTextFile,
} = require("../_shared/utils");
const { gql } = require("../_shared/github");

const token = reqEnv("TOKEN");
const org = reqEnv("ORG");
const number = parseInt(reqEnv("PROJECT_NUMBER"), 10);
const profileLabel = reqEnv("PROFILE_LABEL");
const epicLabel = reqEnv("EPIC_LABEL");

const query = `
query ($org: String!, $number: Int!, $after: String) {
  organization(login: $org) {
    projectV2(number: $number) {
      items(first: 100, after: $after) {
        nodes {
          content {
            __typename
            ... on Issue {
              number
              title
              url
              labels(first: 50) {
                nodes { name }
              }
              parent {
                number
                title
                url
              }
              subIssues(first: 100) {
                nodes {
                  __typename
                  ... on Issue {
                    number
                    title
                    url
                  }
                }
              }
              projectItems(first: 10) {
                nodes {
                  project {
                    number
                    title
                  }
                  fieldValues(first: 20) {
                    nodes {
                      __typename
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        field { ... on ProjectV2SingleSelectField { name } }
                        name
                      }
                      ... on ProjectV2ItemFieldIterationValue {
                        field { ... on ProjectV2IterationField { name } }
                        title
                        startDate
                        duration
                      }
                      ... on ProjectV2ItemFieldTextValue {
                        field { ... on ProjectV2FieldCommon { name } }
                        text
                      }
                    }
                  }
                }
              }
            }
          }
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                field { ... on ProjectV2SingleSelectField { name } }
                name
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

const epicWantedSet = new Set(
  String(epicLabel)
    .split(",")
    .map((label) => normalizeLabel(label))
    .filter(Boolean)
);

const doneDot = "✅";
const inRecetteDot = "🏁";
const inProgressDot = "⏳";
const todoDot = "📝";
const wontDot = "❌";

function normalizeLabel(value) {
  return norm(value).replace(/\s*:\s*/g, ":");
}

function getLabelNames(issueNode) {
  return (issueNode?.labels?.nodes ?? []).map((node) => node.name);
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function parseProfile(labels) {
  const regex = /^Profil\s*:\s*/i;
  const hit = labels.find((label) => regex.test(label));
  return hit ? hit.split(":")[1].trim() : "";
}

function parseImprovementRef(title) {
  const versionRegex = /\bv\s*(\d+)\b[^#]*#\s*(\d+)/i;
  const match = String(title).match(versionRegex);
  return match
    ? { version: parseInt(match[1], 10), base: parseInt(match[2], 10) }
    : null;
}

function statusToDot(name) {
  const normalizedName = String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-’'.,:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/(^|\b)(done)(\b|$)/.test(normalizedName)) return doneDot;
  if (/(^|\b)(recette)(\b|$)/.test(normalizedName)) return inRecetteDot;
  if (/(^|\b)(wont do)(\b|$)/.test(normalizedName)) return wontDot;
  if (/(^|\b)(in progress|in review)(\b|$)/.test(normalizedName)) return inProgressDot;
  return todoDot;
}

function getFieldsForProject(issueNode, projectNumber) {
  const item = issueNode.projectItems?.nodes?.find(
    (projectItem) => projectItem.project?.number === projectNumber
  );

  if (!item) return {};

  const output = {};

  for (const fieldValue of item.fieldValues?.nodes ?? []) {
    const fieldName = String(fieldValue.field?.name || "").trim().toLowerCase();

    if (fieldValue.__typename === "ProjectV2ItemFieldSingleSelectValue") {
      if (fieldName === "status") output.status = fieldValue.name || "";
    } else if (fieldValue.__typename === "ProjectV2ItemFieldIterationValue") {
      if (fieldName === "sprint") output.sprint = fieldValue.title || "";
    }
  }

  return output;
}

function hasEpicLabel(issueNode) {
  const labels = new Set(getLabelNames(issueNode).map(normalizeLabel));
  return [...epicWantedSet].some((wanted) => labels.has(wanted));
}

function isIgnoredStatus(status) {
  const normalizedStatus = String(status ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-’'.,:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizedStatus === "" || /(^|\b)(backlog not ready|a refiner)(\b|$)/.test(normalizedStatus);
}

function buildTableContent(epicTitle, epicUrl, rows) {
  const legend = `*Légende :* ${doneDot} Terminé · ${inRecetteDot} En Recette · ${inProgressDot} En cours/Review · ${todoDot} À faire · ${wontDot} Won’t do`;
  const title = `#### Tableau de fonctionnalités de l'épic : **${
    epicUrl ? `[${escapeCell(epicTitle)}](${epicUrl})` : escapeCell(epicTitle)
  }**`;

  let content = `${title}\n\n${legend}\n\n| Profil | US | Sprint | État | Mise à jour |\n|---|---|:--:|:--:|---|\n`;

  for (const row of rows) {
    content += `| ${row.profile} | ${row.us} | ${row.sprint} | ${row.etat} | ${row.maj} |\n`;
  }

  return content;
}

(async () => {
  let after = null;
  const items = [];

  do {
    const response = await gql(token, query, { org, number, after }, {
      userAgent: "us-table-bot",
      extraHeaders: {
        "GraphQL-Features": "tracked_issues_graphql_access, sub_issues",
      },
    });

    const projectData = response?.organization?.projectV2;
    if (!projectData) {
      throw new Error("Project not found or inaccessible");
    }

    const page = projectData.items;
    items.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  const childToEpicNumber = new Map();
  const epicTitleByNum = new Map();
  const epicUrlByNum = new Map();

  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== "Issue") continue;
    if (!hasEpicLabel(content)) continue;

    epicTitleByNum.set(content.number, content.title);
    epicUrlByNum.set(content.number, content.url);

    for (const child of content.subIssues?.nodes ?? []) {
      childToEpicNumber.set(child.url, content.number);
    }
  }

  const improvementsByBase = new Map();
  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== "Issue") continue;

    const ref = parseImprovementRef(content.title);
    if (!ref) continue;

    if (!improvementsByBase.has(ref.base)) {
      improvementsByBase.set(ref.base, []);
    }
    improvementsByBase.get(ref.base).push(escapeCell(content.title));
  }

  const groups = new Map();

  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== "Issue") continue;

    const labels = getLabelNames(content);
    if (!labels.includes(profileLabel)) continue;
    if (parseImprovementRef(content.title)) continue;

    const epicNumber = content.parent?.number
      ? content.parent.number
      : childToEpicNumber.get(content.url) || null;

    const cofolio = getFieldsForProject(content, 16);
    if (isIgnoredStatus(cofolio.status)) continue;

    const row = {
      profile: parseProfile(labels) || "—",
      us: content.url ? `[${escapeCell(content.title)}](${content.url})` : escapeCell(content.title),
      sprint: cofolio.sprint || "—",
      etat: statusToDot(cofolio.status),
      maj: (improvementsByBase.get(content.number) || []).join(" ; "),
    };

    const key = epicNumber ? String(epicNumber) : "none";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  for (const [, rows] of groups) {
    rows.sort((a, b) => a.us.localeCompare(b.us, "fr", {
      sensitivity: "base",
      numeric: true,
    }));
  }

  ensureDir("epic_tables");

  for (const [key, rows] of groups) {
    const epicNumber = key === "none" ? null : Number(key);
    const epicTitle = epicNumber
      ? epicTitleByNum.get(epicNumber) || `Epic #${epicNumber}`
      : "Sans Epic";
    const epicUrl = epicNumber ? epicUrlByNum.get(epicNumber) : null;

    const content = buildTableContent(epicTitle, epicUrl, rows);
    const filename = key === "none" ? "epic-none.md" : `epic-${key}.md`;

    writeTextFile(`epic_tables/${filename}`, content);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
