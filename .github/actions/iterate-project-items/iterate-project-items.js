const fs = require('fs');

const token = process.env.TOKEN;
const org = process.env.ORG;
const number = parseInt(process.env.PROJECT_NUMBER, 10);
const epicLabel = process.env.EPIC_LABEL;
const usLabel = process.env.US_LABEL;
const outputFormat = process.env.OUTPUT_FORMAT || 'json';

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

async function gql(variables) {
  const apiResponse = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'epic-us-iterator-bot',
      'GraphQL-Features': 'tracked_issues_graphql_access, sub_issues'
    },
    body: JSON.stringify({ query, variables })
  });
  const responseText = await apiResponse.text();
  let jsonResponse;
  try {
    jsonResponse = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`HTTP ${apiResponse.status} ${responseText}`);
  }
  if (!apiResponse.ok || jsonResponse.errors) {
    throw new Error(JSON.stringify(jsonResponse.errors || responseText));
  }
  return jsonResponse.data;
}

const norm = s => (s ?? "").toLowerCase().replace(/\s*:\s*/g, ":").trim();
const labelNames = n => (n?.labels?.nodes ?? []).map(x => x.name);
const epicWantedSet = new Set(String(epicLabel).split(',').map(s => norm(s.trim())).filter(Boolean));
const usWantedSet = new Set(String(usLabel).split(',').map(s => norm(s.trim())).filter(Boolean));

function extractRulesFromBody(body) {
  if (!body) return [];

  // Regex for extracting RGs: \**RG\s*\**\s*:\s*\**\s*(.*)\s*\\n
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
  const item = issueNode.projectItems?.nodes?.find(pi => pi.project?.number === projectNumber);
  if (!item) return {};
  const fields = {};
  for (const fieldValue of item.fieldValues?.nodes ?? []) {
    const fieldName = fieldValue.field?.name?.toLowerCase();
    if (!fieldName) continue;

    if (fieldValue.__typename === 'ProjectV2ItemFieldSingleSelectValue') {
      fields[fieldName] = fieldValue.name || '';
    } else if (fieldValue.__typename === 'ProjectV2ItemFieldIterationValue') {
      fields[fieldName] = {
        title: fieldValue.title || '',
        startDate: fieldValue.startDate || '',
        duration: fieldValue.duration || 0
      };
    } else if (fieldValue.__typename === 'ProjectV2ItemFieldTextValue') {
      fields[fieldName] = fieldValue.text || '';
    } else if (fieldValue.__typename === 'ProjectV2ItemFieldNumberValue') {
      fields[fieldName] = fieldValue.number || 0;
    }
  }
  return fields;
}

(async () => {
  console.log(`🔍 Fetching items from project #${number} in ${org}...`);

  let after = null, items = [];
  do {
    const graphQLResponse = await gql({ org, number, after });
    const projectData = graphQLResponse?.organization?.projectV2;
    if (!projectData) throw new Error('Project not found or inaccessible');
    const page = projectData.items;
    items.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  console.log(`📊 Total items fetched: ${items.length}`);

  // Map for storing parent-child relationships
  const childToEpicNumber = new Map();
  const epics = [];
  const epicByNumber = new Map();

  // First pass: identify Epics
  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== 'Issue') continue;

    const labs = new Set(labelNames(content).map(norm));
    const isEpic = [...epicWantedSet].some(w => labs.has(w));

    if (isEpic) {
      const epicData = {
        number: content.number,
        title: content.title,
        body: content.body || '',
        url: content.url,
        state: content.state,
        labels: labelNames(content),
        fields: getFieldsForProject(content, number),
        rules: extractRulesFromBody(content.body),
        subIssues: []
      };
      epics.push(epicData);
      epicByNumber.set(content.number, epicData);

      // Record relationships with sub-issues
      for (const child of (content.subIssues?.nodes ?? [])) {
        childToEpicNumber.set(child.url, content.number);
      }
    }
  }

  console.log(`✨ Epics found: ${epics.length}`);

  // Second pass: associate US with Epics
  const userStories = [];
  const orphanUS = [];

  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== 'Issue') continue;

    const labs = new Set(labelNames(content).map(norm));
    const isEpic = [...epicWantedSet].some(w => labs.has(w));
    const isUS = [...usWantedSet].some(w => labs.has(w));

    // Ignore Epics in this pass
    if (isEpic) continue;

    // Only keep User Stories (ignore tasks and other issues)
    if (!isUS) continue;

    // Determine parent Epic
    const epicNum = content.parent?.number ? content.parent.number : childToEpicNumber.get(content.url) || null

    const usData = {
      number: content.number,
      title: content.title,
      body: content.body || '',
      url: content.url,
      state: content.state,
      labels: labelNames(content),
      fields: getFieldsForProject(content, number),
      rules: extractRulesFromBody(content.body),
      epicNumber: epicNum
    };

    userStories.push(usData);

    // Add the US to its Epic if found, otherwise mark as orphan
    if (epicNum && epicByNumber.has(epicNum)) {
      epicByNumber.get(epicNum).subIssues.push(usData);
    } else {
      orphanUS.push(usData);
    }
  }

  console.log(`📝 User Stories found: ${userStories.length}`);
  console.log(`🔗 User Stories linked to Epics: ${userStories.length - orphanUS.length}`);
  console.log(`❓ Orphan User Stories: ${orphanUS.length}`);

  // Generate outputs
  const summary = {
    projectNumber: number,
    organization: org,
    fetchedAt: new Date().toISOString(),
    stats: {
      totalEpics: epics.length,
      totalUserStories: userStories.length,
      linkedUserStories: userStories.length - orphanUS.length,
      orphanUserStories: orphanUS.length
    },
    epics: epics.map(e => ({
      ...e,
      subIssuesCount: e.subIssues.length
    })),
    orphanUserStories: orphanUS
  };

  // Save the global summary
  if (outputFormat === 'json') {
    fs.writeFileSync('project-items.json', JSON.stringify(summary, null, 2), 'utf8');
    console.log('✅ Global summary saved to project-items.json');
  } else {
    // Format Markdown
    let markdown = `# Projet ${org}/${number}\n\n`;
    markdown += `*Généré le ${new Date().toLocaleString('fr-FR')}*\n\n`;
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
          const status = us.fields.status || 'N/A';
          markdown += `- [#${us.number}](${us.url}) ${us.title} - *${status}*\n`;
        }
        markdown += `\n`;
      } else {
        markdown += `*Aucune User Story associée*\n\n`;
      }
    }

    if (orphanUS.length > 0) {
      markdown += `## ❓ User Stories sans Epic\n\n`;
      for (const us of orphanUS) {
        const status = us.fields.status || 'N/A';
        markdown += `- [#${us.number}](${us.url}) ${us.title} - *${status}*\n`;
      }
    }

    fs.writeFileSync('project-items.md', markdown, 'utf8');
    console.log('✅ Report saved to project-items.md');
  }

  // Outputs for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `epic_count=${epics.length}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `us_count=${userStories.length}\n`);
  }

  console.log('✅ Done!');
})().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
