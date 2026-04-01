const {
  reqEnv,
  readTextFile,
  writeTextFile,
  fileExists,
  isDirectory,
  listDir,
} = require("../_shared/utils");

const pagePath = reqEnv("WIKI_PAGE");
const dir = process.env.TABLES_DIR || "epic_tables";
const prefix = process.env.MARKER_PREFIX || "US_TABLE";
const createMissing = String(process.env.CREATE_MISSING_SECTION || "true").toLowerCase() === "true";

if (!fileExists(pagePath)) {
  throw new Error(`Wiki page not found: ${pagePath}`);
}

function escapeRegexSpecialChars(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMarkerRegex(startMarker, endMarker) {
  return new RegExp(
    `${escapeRegexSpecialChars(startMarker)}[\\s\\S]*?${escapeRegexSpecialChars(endMarker)}`,
    "g"
  );
}

function trimTrailingWhitespace(text) {
  return text.replace(/\s+$/, "");
}

function readEpicFiles(directory) {
  const regex = /^epic-(\d+)\.md$/i;

  if (!isDirectory(directory)) {
    return [];
  }

  return listDir(directory)
    .flatMap((filename) => {
      const match = filename.match(regex);
      return match ? [{ file: filename, num: Number(match[1]) }] : [];
    })
    .sort((a, b) => a.num - b.num);
}

let page = readTextFile(pagePath);
const files = readEpicFiles(dir);

for (const { file, num } of files) {
  const start = `<!-- ${prefix}_START_${num} -->`;
  const end = `<!-- ${prefix}_END_${num} -->`;
  const body = trimTrailingWhitespace(readTextFile(`${dir}/${file}`));
  const block = `${start}\n${body}\n${end}`;
  const regex = buildMarkerRegex(start, end);

  if (regex.test(page)) {
    page = page.replace(regex, block);
  } else if (createMissing) {
    if (!/\n$/.test(page)) {
      page += "\n";
    }
    page += `\n${block}\n`;
  }
}

const allStart = `<!-- ${prefix}_START_ALL -->`;
const allEnd = `<!-- ${prefix}_END_ALL -->`;
const allBody = files
  .map(({ num }) => trimTrailingWhitespace(readTextFile(`${dir}/epic-${num}.md`)) + "\n\n")
  .join("");
const allBlock = `${allStart}\n${allBody}\n${allEnd}`;
const allRegex = buildMarkerRegex(allStart, allEnd);

if (allRegex.test(page)) {
  page = page.replace(allRegex, allBlock);
}

writeTextFile(pagePath, page);
