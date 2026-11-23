const { reqEnv } = require("../_shared/utils");
const { restGet, restPost } = require("../_shared/github");

const BASE_BRANCH = "develop";

(async () => {
  const token = reqEnv("TOKEN");
  const org = reqEnv("ORG");
  const tag = reqEnv("TAG");
  const title = reqEnv("TITLE");
  const primaryRepository = reqEnv("PRIMARY_REPOSITORY");
  const primaryBody = process.env.PRIMARY_BODY || "";
  const options = { userAgent: "create-release-on-repositories" };

  const rawRepositories = reqEnv("REPOSITORIES").trim();
  const names = rawRepositories.startsWith("[") ? JSON.parse(rawRepositories) : rawRepositories.split(/[,\n]/);
  const repositories = [
    ...new Set([
      primaryRepository,
      ...names.map((name) => name.trim()).filter(Boolean).map((name) => (name.includes("/") ? name : `${org}/${name}`)),
    ]),
  ];

  console.log(`ℹ️ Repositories: ${repositories.join(", ")}`);

  const plans = [];
  const errors = [];

  for (const repository of repositories) {
    const url = `https://api.github.com/repos/${repository}`;
    try {
      const info = await restGet(token, url, options);
      if (!info) throw new Error("repository not found or inaccessible");

      const branch = await restGet(token, `${url}/branches/${BASE_BRANCH}`, options);
      if (!branch) throw new Error(`branch "${BASE_BRANCH}" not found`);

      plans.push({
        repository,
        url,
        sha: branch.commit.sha,
        tagExists: !!(await restGet(token, `${url}/git/ref/tags/${tag}`, options)),
        releaseExists: !!(await restGet(token, `${url}/releases/tags/${tag}`, options)),
      });
    } catch (error) {
      errors.push(`${repository}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Preflight failed, nothing created:\n- ${errors.join("\n- ")}`);
  }

  const failures = [];

  for (const { repository, url, sha, tagExists, releaseExists } of plans) {
    try {
      if (releaseExists) {
        console.log(`⚠️ ${repository}: release "${tag}" already exists, skipped.`);
        continue;
      }

      if (tagExists) {
        console.log(`⚠️ ${repository}: tag "${tag}" already exists, not moved.`);
      } else {
        await restPost(token, `${url}/git/refs`, { ref: `refs/tags/${tag}`, sha }, options);
      }

      await restPost(
        token,
        `${url}/releases`,
        { tag_name: tag, name: title, body: repository === primaryRepository ? primaryBody : "" },
        options
      );
      console.log(`✅ ${repository}: release "${tag}" created.`);
    } catch (error) {
      console.error(`❌ ${repository}: ${error.message}`);
      failures.push(repository);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length < plans.length ? "Partial run" : "Run failed"}: ${failures.length}/${plans.length} repositories failed (${failures.join(", ")}). Relaunch with the same inputs to complete.`
    );
  }
})().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
