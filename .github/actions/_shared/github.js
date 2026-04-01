const { norm } = require("./utils");

async function parseJsonResponse(res, text, context) {
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${context} non-JSON response: HTTP ${res.status} ${text}`);
  }

  return json;
}

async function gql(token, query, variables = {}, options = {}) {
  const {
    userAgent = "github-script",
    extraHeaders = {},
  } = options;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
      ...extraHeaders,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (!res.ok || json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors ?? json)}`);
  }

  return json.data;
}

async function restPost(token, url, body, options = {}) {
  const { userAgent = "github-script" } = options;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(`REST POST error: HTTP ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}

function findProjectSingleSelectField(fields, fieldName, options = {}) {
  const fieldNameNorm = norm(fieldName, options);

  return (fields ?? []).find(
    (field) =>
      field?.__typename === "ProjectV2SingleSelectField" &&
      norm(field.name, options) === fieldNameNorm
  );
}

function findSingleSelectOption(field, optionName, options = {}) {
  const optionNameNorm = norm(optionName, options);

  return (field?.options ?? []).find(
    (option) => norm(option.name, options) === optionNameNorm
  );
}

function findSingleSelectFieldValue(fieldValues, fieldId) {
  return (fieldValues ?? []).find(
    (fieldValue) =>
      fieldValue?.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
      fieldValue.field?.id === fieldId
  );
}

module.exports = {
  gql,
  restPost,
  findProjectSingleSelectField,
  findSingleSelectOption,
  findSingleSelectFieldValue,
};
