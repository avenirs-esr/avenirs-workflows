const {
  reqEnv,
  norm,
  appendOutputs,
  writeTextFile,
  getIsoNow,
} = require("../_shared/utils");
const { gql } = require("../_shared/github");

const token = reqEnv("TOKEN");
const org = reqEnv("ORG");
const number = parseInt(reqEnv("PROJECT_NUMBER"), 10);
const epicLabel = reqEnv("EPIC_LABEL");
const usLabel = reqEnv("US_LABEL");
const outputFormat = process.env.OUTPUT_FORMAT || "json";

const query = `
query ($org: String!, $number: Int!, $after: String) {
  organization(login: $org) {
    projectV2(number: $number) {
      title
      items(first: 100, after: $after) {
        nodes {
          content {
            __typename
            ... on Issue {
              number
              title
              body
              url
              state
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
                    body
                    url
                    state
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
                      ... on ProjectV2ItemFieldNumberValue {
                        field { ... on ProjectV2FieldCommon { name } }
                        number
                      }
                    }
                  }
                }
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
    .map((label) => norm(label).replace(/\s*:\s*/g, ":"))
    .filter(Boolean)
);

const usWantedSet = new Set(
  String(usLabel)
    .split(",")
    .map((label) => norm(label).replace(/\s*:\s*/g, ":"))
    .filter(Boolean)
);

function normalizeLabel(value) {
  return norm(value).replace(/\s*:\s*/g, ":");
}

function getLabelNames(issueNode) {
  return (issueNode?.labels?.nodes ?? []).map((node) => node.name);
}

function extractRulesFromBody(body) {
  if (!body) return [];

  const rgRegex = /\**RG\s*\**\s*:\s*\**\s*(.*?)\s*(?:\n|$)/gi;
  const rules = [];
  let match;

  while ((match = rgRegex.exec(body)) !== null) {
    const rule = match[1].trim();
    if (rule) {
      rules.push(rule);
    }
  }

  return rules;
}

function getFieldsForProject(issueNode, projectNumber) {
  const item = issueNode.projectItems?.nodes?.find(
    (projectItem) => projectItem.project?.number === projectNumber
  );

  if (!item) return {};

  const fields = {};

  for (const fieldValue of item.fieldValues?.nodes ?? []) {
    const fieldName = fieldValue.field?.name?.toLowerCase();
    if (!fieldName) continue;

    if (fieldValue.__typename === "ProjectV2ItemFieldSingleSelectValue") {
      fields[fieldName] = fieldValue.name || "";
    } else if (fieldValue.__typename === "ProjectV2ItemFieldIterationValue") {
      fields[fieldName] = {
        title: fieldValue.title || "",
        startDate: fieldValue.startDate || "",
        duration: fieldValue.duration || 0,
      };
    } else if (fieldValue.__typename === "ProjectV2ItemFieldTextValue") {
      fields[fieldName] = fieldValue.text || "";
    } else if (fieldValue.__typename === "ProjectV2ItemFieldNumberValue") {
      fields[fieldName] = fieldValue.number || 0;
    }
  }

  return fields;
}

function hasWantedLabel(issueNode, wantedSet) {
  const labels = new Set(getLabelNames(issueNode).map(normalizeLabel));
  return [...wantedSet].some((wanted) => labels.has(wanted));
}

function createIssueData(issueNode, projectNumber, extra = {}) {
  return {
    number: issueNode.number,
    title: issueNode.title,
    body: issueNode.body || "",
    url: issueNode.url,
    state: issueNode.state,
    labels: getLabelNames(issueNode),
    fields: getFieldsForProject(issueNode, projectNumber),
    rules: extractRulesFromBody(issueNode.body),
    ...extra,
  };
}

function buildMarkdownReport(summary, epics, orphanUserStories) {
  let markdown = `# Projet ${org}/${number}\n\n`;
  markdown += `*Généré le ${new Date().toLocaleString("fr-FR")}*\n\n`;
  markdown += `## 📊 Statistiques\n\n`;
  markdown += `- **Epics totales :** ${summary.stats.totalEpics}\n`;
  markdown += `- **User Stories totales :** ${summary.stats.totalUserStories}\n`;
  markdown += `- **US liées à des Epics :** ${summary.stats.linkedUserStories}\n`;
  markdown += `- **US orphelines :** ${summary.stats.orphanUserStories}\n\n`;

  for (const epic of epics) {
    markdown += `## Epic #${epic.number}: [${epic.title}](${epic.url})\n\n`;
    markdown += `**État :** ${epic.state}\n\n`;

    if (epic.subIssues.length > 0) {
      markdown += `### User Stories (${epic.subIssues.length})\n\n`;
      for (const us of epic.subIssues) {
        const status = us.fields.status || "N/A";
        markdown += `- [#${us.number}](${us.url}) ${us.title} - *${status}*\n`;
      }
      markdown += `\n`;
    } else {
      markdown += `*Aucune User Story associée*\n\n`;
    }
  }

  if (orphanUserStories.length > 0) {
    markdown += `## ❓ User Stories sans Epic\n\n`;
    for (const us of orphanUserStories) {
      const status = us.fields.status || "N/A";
      markdown += `- [#${us.number}](${us.url}) ${us.title} - *${status}*\n`;
    }
  }

  return markdown;
}

(async () => {
  console.log(`🔍 Fetching items from project #${number} in ${org}...`);

  let after = null;
  const items = [];

  do {
    const response = await gql(token, query, { org, number, after }, {
      userAgent: "epic-us-iterator-bot",
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

  console.log(`📊 Total items fetched: ${items.length}`);

  const childToEpicNumber = new Map();
  const epics = [];
  const epicByNumber = new Map();

  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== "Issue") continue;

    if (!hasWantedLabel(content, epicWantedSet)) continue;

    const epicData = createIssueData(content, number, {
      subIssues: [],
    });

    epics.push(epicData);
    epicByNumber.set(content.number, epicData);

    for (const child of content.subIssues?.nodes ?? []) {
      childToEpicNumber.set(child.url, content.number);
    }
  }

  console.log(`✨ Epics found: ${epics.length}`);

  const userStories = [];
  const orphanUserStories = [];

  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== "Issue") continue;

    const isEpic = hasWantedLabel(content, epicWantedSet);
    const isUserStory = hasWantedLabel(content, usWantedSet);

    if (isEpic) continue;
    if (!isUserStory) continue;

    const epicNumber = content.parent?.number
      ? content.parent.number
      : childToEpicNumber.get(content.url) || null;

    const userStoryData = createIssueData(content, number, {
      epicNumber,
    });

    userStories.push(userStoryData);

    if (epicNumber && epicByNumber.has(epicNumber)) {
      epicByNumber.get(epicNumber).subIssues.push(userStoryData);
    } else {
      orphanUserStories.push(userStoryData);
    }
  }

  console.log(`📝 User Stories found: ${userStories.length}`);
  console.log(`🔗 User Stories linked to Epics: ${userStories.length - orphanUserStories.length}`);
  console.log(`❓ Orphan User Stories: ${orphanUserStories.length}`);

  const summary = {
    projectNumber: number,
    organization: org,
    fetchedAt: getIsoNow(),
    stats: {
      totalEpics: epics.length,
      totalUserStories: userStories.length,
      linkedUserStories: userStories.length - orphanUserStories.length,
      orphanUserStories: orphanUserStories.length,
    },
    epics: epics.map((epic) => ({
      ...epic,
      subIssuesCount: epic.subIssues.length,
    })),
    orphanUserStories,
  };

  if (outputFormat === "json") {
    writeTextFile("project-items.json", JSON.stringify(summary, null, 2));
    console.log("✅ Global summary saved to project-items.json");
  } else {
    const markdown = buildMarkdownReport(summary, epics, orphanUserStories);
    writeTextFile("project-items.md", markdown);
    console.log("✅ Report saved to project-items.md");
  }

  appendOutputs({
    epic_count: epics.length,
    us_count: userStories.length,
  });

  console.log("✅ Done!");
})().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
