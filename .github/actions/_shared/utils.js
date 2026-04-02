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
};
