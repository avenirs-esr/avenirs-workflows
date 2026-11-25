const fs = require("fs");
const path = require("path");
const { reqEnv } = require("../_shared/utils");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function keysOf(repo, content) {
  if (repo === "srv-dev") return ["srv-dev"];
  if (repo === "avenirs-portfolio-common") {
    return [...content.matchAll(/^[ \t]*(services\/avenirs-portfolio\/[^\s=]+\/libs\/avenirs-portfolio-common)[ \t]*=/gm)].map((match) => match[1]);
  }
  return [`services/avenirs-portfolio/${repo}`];
}

try {
  const confPath = path.resolve(reqEnv("SRV_BASE_PATH"), process.env.CONF_DIR || "", reqEnv("CONF_FILE"));
  const pairs = reqEnv("RESOLVED_PAIRS").split(/\r?\n/).filter(Boolean);

  console.log(`🎯 Conf file: ${confPath}`);
  if (!fs.existsSync(confPath)) throw new Error("Conf file not found (check CONF_PATH / CONF_FILE / SRV_BASE_PATH)");

  let content = fs.readFileSync(confPath, "utf8");
  const missing = [];

  for (const pair of pairs) {
    const [repo, tag] = pair.split("=").map((part) => part.trim());
    const keys = repo && tag ? keysOf(repo, content) : [];
    if (keys.length === 0) missing.push(repo || pair);

    for (const key of keys) {
      const line = new RegExp(`^([ \\t]*)${escapeRegex(key)}[ \\t]*=[^\\r\\n]*`, "m");
      if (!line.test(content)) {
        missing.push(key);
        continue;
      }
      content = content.replace(line, (_, indent) => `${indent}${key} = ${tag}`);
      console.log(`✅ ${key} = ${tag}`);
    }
  }

  if (missing.length > 0) throw new Error(`Key(s) not found in conf, nothing written: ${missing.join(", ")}`);

  fs.writeFileSync(confPath, content);
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
