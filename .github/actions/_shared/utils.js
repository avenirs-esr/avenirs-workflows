const fs = require("fs");

function reqEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function norm(value, options = {}) {
  const { stripEmoji = false } = options;

  let result = String(value ?? "").toLowerCase();

  if (stripEmoji) {
    result = result.replace(/\p{Extended_Pictographic}/gu, "");
  }

  return result.replace(/\s+/g, " ").trim();
}

function appendOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value ?? ""}\n`);
}

function appendOutputs(entries) {
  if (!process.env.GITHUB_OUTPUT) return;

  for (const [key, value] of Object.entries(entries)) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value ?? ""}\n`);
  }
}

function readJsonFile(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function writeTextFile(filepath, content) {
  fs.writeFileSync(filepath, content, "utf8");
}

function ensureDir(dirpath) {
  fs.mkdirSync(dirpath, { recursive: true });
}

function readTextFile(filepath) {
  return fs.readFileSync(filepath, "utf8");
}

function fileExists(filepath) {
  return fs.existsSync(filepath);
}

function isDirectory(filepath) {
  return fs.existsSync(filepath) && fs.statSync(filepath).isDirectory();
}

function listDir(dirpath) {
  return fs.readdirSync(dirpath);
}

function getIsoNow() {
  return new Date().toISOString();
}

function isCurrentSprintToken(value) {
  return norm(value, { stripEmoji: true }) === "@current";
}

function findProjectIterationField(fields, fieldName, options = {}) {
  const wantedField = norm(fieldName, options);

  return (fields ?? []).find((field) => {
    if (!field || field.__typename !== "ProjectV2IterationField") {
      return false;
    }

    return norm(field.name, options) === wantedField;
  });
}

function findIterationFieldValue(fieldValues, fieldName, options = {}) {
  const wantedField = norm(fieldName, options);

  return (fieldValues ?? []).find((node) => {
    if (!node || node.__typename !== "ProjectV2ItemFieldIterationValue") {
      return false;
    }

    const currentFieldName = node.field?.name ?? "";
    return norm(currentFieldName, options) === wantedField;
  });
}

function toUtcDateAtMidnight(dateLike) {
  if (!dateLike) return null;

  if (dateLike instanceof Date) {
    return new Date(Date.UTC(
      dateLike.getUTCFullYear(),
      dateLike.getUTCMonth(),
      dateLike.getUTCDate()
    ));
  }

  if (typeof dateLike === "string") {
    return new Date(`${dateLike}T00:00:00.000Z`);
  }

  return null;
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isDateWithinIteration(date, iteration) {
  if (!iteration?.startDate || typeof iteration.duration !== "number") {
    return false;
  }

  const currentDate = toUtcDateAtMidnight(date);
  const startDate = toUtcDateAtMidnight(iteration.startDate);

  if (!currentDate || !startDate || Number.isNaN(startDate.getTime())) {
    return false;
  }

  const endDateExclusive = addUtcDays(startDate, iteration.duration);

  return currentDate >= startDate && currentDate < endDateExclusive;
}

function getAllIterationConfigurations(iterationField) {
  const config = iterationField?.configuration ?? {};

  return [
    ...(config.iterations ?? []),
    ...(config.completedIterations ?? []),
  ];
}

function resolveCurrentIteration(iterationField, now = new Date()) {
  const iterations = getAllIterationConfigurations(iterationField);

  return iterations.find((iteration) => isDateWithinIteration(now, iteration)) ?? null;
}

function resolveCurrentIterationTitle(iterationField, now = new Date()) {
  return resolveCurrentIteration(iterationField, now)?.title ?? "";
}

module.exports = {
  reqEnv,
  norm,
  appendOutput,
  appendOutputs,
  readJsonFile,
  writeTextFile,
  ensureDir,
  readTextFile,
  fileExists,
  isDirectory,
  listDir,
  getIsoNow,
  isCurrentSprintToken,
  findProjectIterationField,
  findIterationFieldValue,
  resolveCurrentIteration,
  resolveCurrentIterationTitle,
};
