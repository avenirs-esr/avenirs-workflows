const fs = require('fs');

const pagePath = process.env.WIKI_PAGE;
const dir = process.env.TABLES_DIR || 'epic_tables';
const prefix = process.env.MARKER_PREFIX || 'US_TABLE';
const createMissing = String(process.env.CREATE_MISSING_SECTION || 'true').toLowerCase() === 'true';

if (!pagePath) throw new Error('WIKI_PAGE is required');
if (!fs.existsSync(pagePath)) throw new Error(`Wiki page not found: ${pagePath}`);

const regex = /^epic-(\d+)\.md$/i;
let files = [];
if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
  files = fs.readdirSync(dir).flatMap(f => {
    const m = f.match(regex);
    if (!m) return [];
    const body = fs.readFileSync(`${dir}/${f}`, 'utf8').replace(/\s+$/, '');
    return [{ file: f, num: Number(m[1]), body }];
  }).sort((a, b) => a.num - b.num);
}

function escapeRegexSpecialChars(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

let page = fs.readFileSync(pagePath,'utf8');

{
  const startAll = `<!-- ${prefix}_START_ALL -->`;
  const endAll   = `<!-- ${prefix}_END_ALL -->`;
  const reAll = new RegExp(`${escapeRegexSpecialChars(startAll)}[\\s\\S]*?${escapeRegexSpecialChars(endAll)}`,'g');

  if (reAll.test(page) || createMissing) {
    const allBody = files.map(x => x.body).join('\n\n');
    const blockAll = `${startAll}\n${allBody}\n${endAll}`;
    if (reAll.test(page)) {
      page = page.replace(reAll, blockAll);
    } else if (createMissing) {
      if (!/\n$/.test(page)) page += '\n';
      page += `\n${blockAll}\n`;
    }
  }
}

for (const {num, body} of files) {
  const start = `<!-- ${prefix}_START_${num} -->`;
  const end   = `<!-- ${prefix}_END_${num} -->`;
  const block = `${start}\n${body}\n${end}`;
  const re = new RegExp(`${escapeRegexSpecialChars(start)}[\\s\\S]*?${escapeRegexSpecialChars(end)}`,'g');
  if (re.test(page)) {
    page = page.replace(re, block);
  } else if (createMissing) {
    if (!/\n$/.test(page)) page += '\n';
    page += `\n${block}\n`;
  }
}

fs.writeFileSync(pagePath, page, 'utf8');
