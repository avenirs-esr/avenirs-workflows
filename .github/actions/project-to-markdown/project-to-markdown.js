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
  const r = await fetch('https://api.github.com/graphql',{
    method:'POST',
    headers:{
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'us-table-bot',
      'GraphQL-Features': 'tracked_issues_graphql_access, sub_issues'
    },
    body: JSON.stringify({ query, variables })
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch(e){ throw new Error(`HTTP ${r.status} ${t}`); }
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors||t));
  return j.data;
}

const norm = s => (s ?? "").toLowerCase().replace(/\s*:\s*/g, ":").trim();
const labelNames = n => (n?.labels?.nodes ?? []).map(x => x.name);
const epicWantedSet = new Set(String(epicLabel).split(',').map(s=>norm(s.trim())).filter(Boolean));
const escapeCell = s => String(s??'').replace(/\|/g,'\\|');

function parseProfile(labels){
  const regex = /^Profil\s*:\s*/i;
  const hit = labels.find(n => regex.test(n));
  return hit ? hit.split(':')[1].trim() : '';
}

function parseImprovementRef(title) {
  const regex = /\bv\s*(\d+)\b[^#]*#\s*(\d+)/i;
  const m = String(title).match(regex);
  return m ? { version: parseInt(m[1],10), base: parseInt(m[2],10) } : null;
}

function statusToDot(name){
  const n = String(name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-’'.,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/(^|\b)(done)(\b|$)/.test(n)) return '🟢';
  if (/(^|\b)(wont do)(\b|$)/.test(n)) return '🔴';
  if (/(^|\b)(in progress|in review|recette)(\b|$)/.test(n)) return '🟡';
  return '⚪️';
}

function getFieldsForProject(issueNode, projectNumber){
  const item = issueNode.projectItems?.nodes?.find(pi => pi.project?.number === projectNumber);
  if (!item) return {};
  const out = {};
  for (const v of item.fieldValues?.nodes ?? []) {
    if (v.__typename === 'ProjectV2ItemFieldSingleSelectValue') {
      const fname = String(v.field?.name || '').trim().toLowerCase();
      if (fname === 'status') out.status = v.name || '';
    } else if (v.__typename === 'ProjectV2ItemFieldIterationValue') {
      const fname = String(v.field?.name || '').trim().toLowerCase();
      if (fname === 'sprint') out.sprint = v.title || '';
    }
  }
  return out;
}

(async ()=>{
  let after=null, items=[];
  do{
    const d = await gql({org, number, after});
    const proj = d?.organization?.projectV2;
    if (!proj) throw new Error('Project not found or inaccessible');
    const page = proj.items;
    items.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while(after);

  const childToEpicNumber = new Map();
  for (const it of items) {
    const c = it.content;
    if (!c || c.__typename !== 'Issue') continue;
    const labs = new Set(labelNames(c).map(norm));
    const isEpic = [...epicWantedSet].some(w => labs.has(w));
    if (!isEpic) continue;
    for (const child of (c.subIssues?.nodes ?? [])) {
      childToEpicNumber.set(child.url, c.number);
    }
  }

  const improvementsByBase = new Map();
  for (const it of items) {
    const c = it.content;
    if (!c || c.__typename !== 'Issue') continue;
    const ref = parseImprovementRef(c.title);
    if (ref) {
      if (!improvementsByBase.has(ref.base)) improvementsByBase.set(ref.base, []);
      improvementsByBase.get(ref.base).push(escapeCell(c.title));
    }
  }

  const groups = new Map();

  for (const it of items){
    const c = it.content;
    if (!c || c.__typename!=='Issue') continue;

    const labels = labelNames(c);
    if (!labels.includes(profileLabel)) continue;
    if (parseImprovementRef(c.title)) continue;

    let epicNum = null;
    if (c.parent?.number) {
      epicNum = c.parent.number;
    } else {
      epicNum = childToEpicNumber.get(c.url) || null;
    }

    const cofolio = getFieldsForProject(c, 16);
    console.warn(`Processing #${c.number} "${c.title}" cofolio=${JSON.stringify(cofolio)}`);
    const row = {
      profile: parseProfile(labels) || '—',
      us: escapeCell(c.title),
      sprint: cofolio.sprint || '—',
      etat: statusToDot(cofolio.status),
      maj: (improvementsByBase.get(c.number) || []).join(' ; ')
    };

    const key = epicNum ? String(epicNum) : 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [k, arr] of groups) {
    arr.sort((a,b)=> a.us.localeCompare(b.us, 'fr', { sensitivity:'base', numeric:true }));
  }

  fs.mkdirSync('epic_tables', { recursive: true });
  for (const [key, arr] of groups) {
    let t = '| Profil | US | Sprint | État | Mise à jour |\n|---|---|:--:|:--:|---|\n';
    for (const r of arr) t += `| ${r.profile} | ${r.us} | ${r.sprint} | ${r.etat} | ${r.maj} |\n`;
    const name = key === 'none' ? 'epic-none.md' : `epic-${key}.md`;
    fs.writeFileSync(`epic_tables/${name}`, t, 'utf8');
  }
})().catch(e=>{ console.error(e); process.exit(1); });
