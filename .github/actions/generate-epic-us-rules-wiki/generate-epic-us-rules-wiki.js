const fs = require('fs');

const jsonFile = process.env.JSON_FILE || 'project-items.json';
const outputFile = process.env.OUTPUT_FILE || 'epic-us-rules-report.md';
const mode = process.env.MODE || 'full';

function getCurrentDate() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} à ${hours}:${minutes}:${seconds}`;
}

function getRulesCount(item) {
  return item.rules ? item.rules.length : 0;
}

function hasRules(item) {
  return getRulesCount(item) > 0;
}

function appendRules(content, rules) {
  let result = content;
  for (const rule of rules) {
    result += `- ${rule}\n`;
  }
  return result;
}

function appendNestedRules(content, rules) {
  let result = content;
  result += '  - **🔍️ Règles de gestion:**\n';
  for (const rule of rules) {
    result += `    - ${rule}\n`;
  }
  return result;
}

function shouldDisplayEpic(epic) {
  const rulesCount = getRulesCount(epic);

  if (mode !== 'items-with-rules' || rulesCount > 0) {
    return true;
  }

  let hasRulesInSubIssues = false;

  if (epic.subIssues && epic.subIssues.length > 0) {
    for (const us of epic.subIssues) {
      if (hasRules(us)) {
        hasRulesInSubIssues = true;
        break;
      }
    }
  }

  return hasRulesInSubIssues;
}

function shouldDisplayUserStory(us) {
  if (mode === 'items-with-rules' && !hasRules(us)) {
    return false;
  }

  return true;
}

function appendUserStory(content, us) {
  let result = content;
  const usStatus = us.fields?.status || 'N/A';
  const usRulesCount = getRulesCount(us);

  result += `- [#${us.number}](${us.url}): ${us.title} - *${usStatus}* (${us.state})\n`;

  if (mode !== 'no-rules' && usRulesCount > 0) {
    result = appendNestedRules(result, us.rules);
  }

  return result;
}

function generateReport() {
  const jsonData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  let content = '';

  switch (mode) {
    case 'items-with-rules':
      console.log('📝 Generating only Epic/US/Rules with rules Wiki page...');
      content += '# Rapport Epic, User Stories et Règles de Gestion (uniquement Epics/US avec règles de gestion)\n\n';
      break;
    case 'no-rules':
      console.log('📝 Generating All Epic/US without rules Wiki page...');
      content += '# Rapport Epic et User Stories\n\n';
      break;
    case 'full':
    default:
      console.log('📝 Generating All Epic/US/Rules Wiki page...');
      content += '# Rapport Epic, User Stories et Règles de Gestion\n\n';
      break;
  }

  content += `*Généré automatiquement le ${getCurrentDate()}*\n`;

  if (jsonData.stats) {
    content += '\n## 📈 Statistiques\n\n';
    for (const [key, value] of Object.entries(jsonData.stats)) {
      content += `- **${key}:** ${value}\n`;
    }
  }

  content += '\n## 🚀 Epics et User Stories\n';

  if (jsonData.epics && jsonData.epics.length > 0) {
    for (const epic of jsonData.epics) {
      const rulesCount = getRulesCount(epic);
      const usCount = epic.subIssues ? epic.subIssues.length : 0;

      if (!shouldDisplayEpic(epic)) {
        continue;
      }

      content += `\n### ✨ Epic [#${epic.number}](${epic.url}): ${epic.title}\n\n`;
      content += `**État:** ${epic.state} | **User Stories:** ${usCount} | **Règles de gestion:** ${rulesCount}\n`;

      if (mode !== 'no-rules' && rulesCount > 0) {
        content += '\n#### 🔍️ Règles de gestion\n\n';
        content = appendRules(content, epic.rules);
      }

      if (usCount > 0) {
        content += '\n#### ⚡️ User Stories\n\n';

        for (const us of epic.subIssues) {
          if (!shouldDisplayUserStory(us)) {
            continue;
          }

          content = appendUserStory(content, us);
        }
      }
    }
  }

  if (jsonData.orphanUserStories && jsonData.orphanUserStories.length > 0) {
    const orphansToDisplay = mode === 'items-with-rules'
      ? jsonData.orphanUserStories.filter((us) => hasRules(us))
      : jsonData.orphanUserStories;

    if (orphansToDisplay.length > 0) {
      content += '\n## ❓ User Stories sans Epic\n\n';

      for (const us of orphansToDisplay) {
        content = appendUserStory(content, us);
      }
    }
  }

  content += '\n---\n';
  content += '*Ce rapport est généré automatiquement par le workflow GitHub Actions.*\n';

  fs.writeFileSync(outputFile, content, 'utf8');
  console.log(`✅ Wiki page generated: ${outputFile}`);
}

if (require.main === module) {
  generateReport();
}

module.exports = { generateReport };
