const fs = require('fs');

const token   = process.env.TOKEN;
const org     = process.env.ORG;
const number  = parseInt(process.env.PROJECT_NUMBER,10);
const profileLabel = process.env.PROFILE_LABEL;
const epicLabel    = process.env.EPIC_LABEL;
const outFile      = process.env.OUT_FILE;

const query = `
query($org:String!, $number:Int!, $after:String){
  organization(login:$org){
    projectV2(number:$number){
      items(first:100, after:$after){
        nodes{
          content{
            __typename
            ... on Issue {
              number
              title
              url
              updatedAt
              labels(first:50){ nodes{ name } }
              parent{ number title url labels(first:10){ nodes{ name } } }
              subIssues(first:100){ nodes{
                __typename
                ... on Issue { number title url labels(first:10){ nodes{ name } } }
              }}
            }
          }
        }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }
}`;

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

  const childToEpicTitle = new Map();
  const childToEpicNumber = new Map();

  for (const it of items) {
    const c = it.content;
    if (!c || c.__typename !== 'Issue') continue;
    const labs = new Set(labelNames(c).map(norm));
    const isEpic = [...epicWantedSet].some(w => labs.has(w));
    if (!isEpic) continue;
    for (const child of (c.subIssues?.nodes ?? [])) {
      childToEpicTitle.set(child.url, c.title);
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

  const rows = [];
  for (const it of items){
    const c = it.content;
    if (!c || c.__typename!=='Issue') continue;
    const labels = labelNames(c);
    if (!labels.includes(profileLabel)) continue;
    if (parseImprovementRef(c.title)) continue;

    const profile = parseProfile(labels) || '—';

    let epicTitle = '—';
    let epicNum = null;
    if (c.parent) {
      epicTitle = c.parent.title || '—';
      epicNum = c.parent.number || null;
    } else {
      const n = childToEpicNumber.get(c.url);
      const t = childToEpicTitle.get(c.url);
      if (n) epicNum = n;
      if (t) epicTitle = t;
    }

    const us  = escapeCell(c.title);
    const maj = (improvementsByBase.get(c.number) || []).join(' ; ');
    rows.push({ profile, epic: epicTitle, epicNum, us, maj });
  }

  rows.sort((a, b) => {
    const aHas = a.epic && a.epic !== '—';
    const bHas = b.epic && b.epic !== '—';
    if (aHas !== bHas) return aHas ? -1 : 1;
    const e = (a.epic || '').localeCompare(b.epic || '', 'fr', { sensitivity: 'base', numeric: true });
    if (e !== 0) return e;
    return a.us.localeCompare(b.us, 'fr', { sensitivity: 'base', numeric: true });
  });

  let md = '| Profil | Epic | US | Mise à jour |\n|---|---|---|---|\n';
  for (const r of rows){
    md += `| ${r.profile} | ${r.epic} | ${r.us} | ${r.maj} |\n`;
  }
  fs.writeFileSync(outFile, md, 'utf8');

  const groups = new Map();
  for (const r of rows) {
    const key = r.epicNum ? String(r.epicNum) : 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [k, arr] of groups) {
    arr.sort((a,b)=> a.us.localeCompare(b.us, 'fr', { sensitivity:'base', numeric:true }));
  }

  fs.mkdirSync('epic_tables', { recursive: true });
  for (const [key, arr] of groups) {
    let t = '| Profil | US | Mise à jour |\n|---|---|---|\n';
    for (const r of arr) {
      t += `| ${r.profile} | ${r.us} | ${r.maj} |\n`;
    }
    const name = key === 'none' ? 'epic-none.md' : `epic-${key}.md`;
    fs.writeFileSync(`epic_tables/${name}`, t, 'utf8');
  }
})().catch(e=>{ console.error(e); process.exit(1); });
