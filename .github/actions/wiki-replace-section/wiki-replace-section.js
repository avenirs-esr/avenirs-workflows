const fs = require('fs');

const pagePath = process.env.WIKI_PAGE;
const dir = process.env.TABLES_DIR || 'epic_tables';
const prefix = process.env.MARKER_PREFIX || 'US_TABLE';
const createMissing = String(process.env.CREATE_MISSING_SECTION || 'true').toLowerCase() === 'true';

if (!pagePath) throw new Error('WIKI_PAGE is required');
if (!fs.existsSync(pagePath)) throw new Error(`Wiki page not found: ${pagePath}`);

let files = [];
const regex = /^epic-(\d+)\.md$/i;
if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
  files = fs.readdirSync(dir).flatMap(f => {
    const m = f.match(regex);
    return m ? [{ file: f, num: Number(m[1]) }] : [];
  });
  files.sort((a, b) => a.num - b.num);
}

function escapeRegexSpecialChars(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

let page = fs.readFileSync(pagePath,'utf8');

for (const {file,num} of files) {
  const start = `<!-- ${prefix}_START_${num} -->`;
  const end   = `<!-- ${prefix}_END_${num} -->`;
  const body  = fs.readFileSync(`${dir}/${file}`,'utf8').replace(/\s+$/,'');
  const block = `${start}\n${body}\n${end}`;
  const re = new RegExp(`${escapeRegexSpecialChars(start)}[\\s\\S]*?${escapeRegexSpecialChars(end)}`,'g');
  if (re.test(page)) {
    page = page.replace(re, block);
  } else if (createMissing) {
    if (!/\n$/.test(page)) page += '\n';
    page += `\n${block}\n`;
  }
}

const allStart = `<!-- ${prefix}_START_ALL -->`;
const allEnd   = `<!-- ${prefix}_END_ALL -->`;
const allBody = files
  .map(({ num }) => {
    const content = fs.readFileSync(`${dir}/epic-${num}.md`, 'utf8').replace(/\s+$/, '');
    return content + '\n\n';
  })
  .join('');
const allBlock = `${allStart}\n${allBody}\n${allEnd}`;
const allRe = new RegExp(`${escapeRegexSpecialChars(allStart)}[\\s\\S]*?${escapeRegexSpecialChars(allEnd)}`,'g');
if (allRe.test(page)) {
  page = page.replace(allRe, allBlock);
}

fs.writeFileSync(pagePath, page, 'utf8');
