const fs = require('fs');

const token   = process.env.TOKEN;
const org     = process.env.ORG;
const number  = parseInt(process.env.PROJECT_NUMBER,10);
const profileLabel = process.env.PROFILE_LABEL;
const epicLabel    = process.env.EPIC_LABEL;

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

async function gql(variables){
  const apiResponse = await fetch('https://api.github.com/graphql',{
    method:'POST',
    headers:{
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'us-table-bot',
      'GraphQL-Features': 'tracked_issues_graphql_access, sub_issues'
    },
    body: JSON.stringify({ query, variables })
  });
  const responseText = await apiResponse.text();
  let jsonResponse; try { jsonResponse = JSON.parse(responseText); } catch(e){ throw new Error(`HTTP ${apiResponse.status} ${responseText}`); }
  if (!apiResponse.ok || jsonResponse.errors) throw new Error(JSON.stringify(jsonResponse.errors||responseText));
  return jsonResponse.data;
}

const norm = s => (s ?? "").toLowerCase().replace(/\s*:\s*/g, ":").trim();
const labelNames = n => (n?.labels?.nodes ?? []).map(x => x.name);
const epicWantedSet = new Set(String(epicLabel).split(',').map(s=>norm(s.trim())).filter(Boolean));
const escapeCell = s => String(s??'').replace(/\|/g,'\\|');
const doneDot = '✅';
const inProgressDot = '⏳';
const todoDot = '📝';
const wontDot = '❌';

function parseProfile(labels){
  const regex = /^Profil\s*:\s*/i;
  const hit = labels.find(n => regex.test(n));
  return hit ? hit.split(':')[1].trim() : '';
}

function parseImprovementRef(title) {
  const version_regex = /\bv\s*(\d+)\b[^#]*#\s*(\d+)/i;
  const matchArray = String(title).match(version_regex);
  return matchArray ? { version: parseInt(matchArray[1],10), base: parseInt(matchArray[2],10) } : null;
}

function statusToDot(name){
  const normalizedName = String(name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-’'.,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/(^|\b)(done)(\b|$)/.test(normalizedName)) return doneDot;
  if (/(^|\b)(wont do)(\b|$)/.test(normalizedName)) return wontDot;
  if (/(^|\b)(in progress|in review|recette)(\b|$)/.test(normalizedName)) return inProgressDot;
  return todoDot;
}

function getFieldsForProject(issueNode, projectNumber){
  const item = issueNode.projectItems?.nodes?.find(pi => pi.project?.number === projectNumber);
  if (!item) return {};
  const out = {};
  for (const fieldValue of item.fieldValues?.nodes ?? []) {
    if (fieldValue.__typename === 'ProjectV2ItemFieldSingleSelectValue') {
      const fname = String(fieldValue.field?.name || '').trim().toLowerCase();
      if (fname === 'status') out.status = fieldValue.name || '';
    } else if (fieldValue.__typename === 'ProjectV2ItemFieldIterationValue') {
      const fname = String(fieldValue.field?.name || '').trim().toLowerCase();
      if (fname === 'sprint') out.sprint = fieldValue.title || '';
    }
  }
  return out;
}

(async ()=>{
  let after=null, items=[];
  do{
    const graphQLResponse = await gql({org, number, after});
    const projectData = graphQLResponse?.organization?.projectV2;
    if (!projectData) throw new Error('Project not found or inaccessible');
    const page = projectData.items;
    items.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while(after);

  const childToEpicNumber = new Map();
  const epicTitleByNum = new Map();
  const epicUrlByNum   = new Map();
  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== 'Issue') continue;
    const labs = new Set(labelNames(content).map(norm));
    const isEpic = [...epicWantedSet].some(w => labs.has(w));
    if (!isEpic) continue;
    epicTitleByNum.set(content.number, content.title);
    epicUrlByNum.set(content.number, content.url);
    for (const child of (content.subIssues?.nodes ?? [])) {
      childToEpicNumber.set(child.url, content.number);
    }
  }

  const improvementsByBase = new Map();
  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename !== 'Issue') continue;
    const ref = parseImprovementRef(content.title);
    if (ref) {
      if (!improvementsByBase.has(ref.base)) improvementsByBase.set(ref.base, []);
      improvementsByBase.get(ref.base).push(escapeCell(content.title));
    }
  }

  const groups = new Map();

  for (const item of items){
    const content = item.content;
    if (!content || content.__typename!=='Issue') continue;

    const labels = labelNames(content);
    if (!labels.includes(profileLabel)) continue;
    if (parseImprovementRef(content.title)) continue;

    let epicNum = null;
    if (content.parent?.number) {
      epicNum = content.parent.number;
    } else {
      epicNum = childToEpicNumber.get(content.url) || null;
    }

    const cofolio = getFieldsForProject(content, 16);
    const row = {
      profile: parseProfile(labels) || '—',
      us: content.url ? `[${escapeCell(content.title)}](${content.url})` : escapeCell(content.title),
      sprint: cofolio.sprint || '—',
      etat: statusToDot(cofolio.status),
      maj: (improvementsByBase.get(content.number) || []).join(' ; ')
    };

    const key = epicNum ? String(epicNum) : 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [k, arr] of groups) {
    arr.sort((a,b)=> a.us.localeCompare(b.us, 'fr', { sensitivity:'base', numeric:true }));
  }

  fs.mkdirSync('epic_tables', { recursive: true });
  const LEGEND = `*Légende :* ${doneDot} Terminé · ${inProgressDot} En cours/Review/Recette · ${todoDot} À faire · ${wontDot} Won’t do`;
  for (const [key, arr] of groups) {
    const epicNum = key === 'none' ? null : Number(key);
    const epicTitle = epicNum ? (epicTitleByNum.get(epicNum) || `Epic #${epicNum}`) : 'Sans Epic';
    const epicUrl   = epicNum ? epicUrlByNum.get(epicNum) : null;
    const TITLE = `#### Tableau de fonctionnalités de l'épic : **${
      epicUrl ? `[${escapeCell(epicTitle)}](${epicUrl})` : escapeCell(epicTitle)
    }**`;
    let tableContent = `${TITLE}\n\n${LEGEND}\n\n| Profil | US | Sprint | État | Mise à jour |\n|---|---|:--:|:--:|---|\n`;
    for (const row of arr) tableContent += `| ${row.profile} | ${row.us} | ${row.sprint} | ${row.etat} | ${row.maj} |\n`;
    const name = key === 'none' ? 'epic-none.md' : `epic-${key}.md`;
    fs.writeFileSync(`epic_tables/${name}`, tableContent, 'utf8');
  }
})().catch(e=>{ console.error(e); process.exit(1); });
