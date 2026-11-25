const fs = require("fs");
const { reqEnv } = require("../_shared/utils");
const { restGet } = require("../_shared/github");

const options = { userAgent: "resolve-sprint-tags" };

function parseRepositories(raw, org) {
  const names = raw.trim().startsWith("[") ? JSON.parse(raw) : raw.split(/[,\n]/);
  return [
    ...new Set(names.map((name) => name.trim()).filter(Boolean).map((name) => (name.includes("/") ? name : `${org}/${name}`))),
  ];
}

async function resolveFromSprint(token, repository, sprint) {
  const needle = `(${sprint})`.toLowerCase();
  const releases = (await restGet(token, `https://api.github.com/repos/${repository}/releases?per_page=100`, options)) ?? [];
  const matches = releases
    .filter((release) => !release.draft && (release.name ?? "").toLowerCase().includes(needle))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (matches.length === 0) throw new Error(`no release titled "...${needle}" found`);
  return matches[0].tag_name;
}

async function checkExplicitTag(token, repository, tag) {
  const ref = await restGet(token, `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, options);
  if (!ref) throw new Error(`tag "${tag}" not found`);
  return tag;
}

(async () => {
  const token = reqEnv("TOKEN");
  const org = reqEnv("ORG");
  const sprint = (process.env.SPRINT || "").trim();
  const explicitTag = (process.env.TAG || "").trim();

  if (!sprint && !explicitTag) throw new Error("Either sprint or tag must be provided.");

  const repositories = parseRepositories(reqEnv("REPOSITORIES"), org);
  console.log(`ℹ️ Repositories: ${repositories.join(", ")}`);
  console.log(`ℹ️ Mode: ${explicitTag ? `explicit tag "${explicitTag}"` : `latest release of "${sprint}"`}`);

  const pairs = [];
  const errors = [];

  for (const repository of repositories) {
    try {
      const tag = explicitTag
        ? await checkExplicitTag(token, repository, explicitTag)
        : await resolveFromSprint(token, repository, sprint);
      pairs.push(`${repository.split("/").pop()}=${tag}`);
      console.log(`✅ ${repository} → ${tag}`);
    } catch (error) {
      errors.push(`${repository}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Tag resolution failed, nothing deployed:\n- ${errors.join("\n- ")}`);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `resolved_pairs<<RESOLVED_EOF\n${pairs.join("\n")}\nRESOLVED_EOF\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = pairs.map((pair) => `| ${pair.split("=")[0]} | \`${pair.split("=")[1]}\` |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Tags to deploy\n\n| Repository | Tag |\n|---|---|\n${rows.join("\n")}\n`);
  }
})().catch((error) => {
  console.error(`::error::${error.message.replace(/\n/g, "%0A")}`);
  process.exit(1);
});
