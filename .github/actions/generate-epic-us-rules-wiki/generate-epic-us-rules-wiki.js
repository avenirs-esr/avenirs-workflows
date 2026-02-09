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
      const rulesCount = epic.rules ? epic.rules.length : 0;
      const usCount = epic.subIssues ? epic.subIssues.length : 0;

      if(mode === 'items-with-rules' && rulesCount === 0) {
        let hasRules = false

        if(epic.subIssues && epic.subIssues.length > 0) {
          for(const us of epic.subIssues) {
            if(us.rules && us.rules.length > 0) {
              hasRules = true;
              break;
            }
          }
        }

        if(!hasRules) {
          continue;
        }
      }

      content += `\n### ✨ Epic [#${epic.number}](${epic.url}): ${epic.title}\n\n`;
      content += `**État:** ${epic.state} | **User Stories:** ${usCount} | **Règles de gestion:** ${rulesCount}\n`;

      if (mode !== 'no-rules' && rulesCount > 0) {
        content += '\n#### 🔍️ Règles de gestion\n\n';
        for (const rule of epic.rules) {
          content += `- ${rule}\n`;
        }
      }

      if (usCount > 0) {
        content += '\n#### ⚡️ User Stories\n\n';
        for (const us of epic.subIssues) {
          const usStatus = us.fields?.status || 'N/A';
          const usRulesCount = us.rules ? us.rules.length : 0;

          if (mode === 'items-with-rules' && usRulesCount === 0) {
            continue;
          }

          content += `- [#${us.number}](${us.url}): ${us.title} - *${usStatus}* (${us.state})\n`;

          if (mode !== 'no-rules' && usRulesCount > 0) {
            content += '  - **🔍️ Règles de gestion:**\n';
            for (const rule of us.rules) {
              content += `    - ${rule}\n`;
            }
          }
        }
      }
    }
  }

  if (jsonData.orphanUserStories && jsonData.orphanUserStories.length > 0) {
    const orphansToDisplay = mode === 'items-with-rules'
      ? jsonData.orphanUserStories.filter(us => us.rules && us.rules.length > 0)
      : jsonData.orphanUserStories;

    if (orphansToDisplay.length > 0) {
      content += '\n## ❓ User Stories sans Epic\n\n';

      for (const us of orphansToDisplay) {
        const usStatus = us.fields?.status || 'N/A';
        const usRulesCount = us.rules ? us.rules.length : 0;

        content += `- [#${us.number}](${us.url}): ${us.title} - *${usStatus}* (${us.state})\n`;

        if (mode !== 'no-rules' && usRulesCount > 0) {
          content += '  - **🔍️ Règles de gestion:**\n';
          for (const rule of us.rules) {
            content += `    - ${rule}\n`;
          }
        }
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
