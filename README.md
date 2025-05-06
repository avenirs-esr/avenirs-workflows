# 🛠️ Avenirs Workflows

Ce dépôt centralise les **actions composites** et **workflows GitHub réutilisables** de l'organisation **Avenirs**.
Il permet de standardiser, partager et maintenir une intégration continue (CI/CD) propre et cohérente entre tous les projets.

---

## 📁 Structure du dépôt

```
avenirs-workflows/
├── actions/                # Actions composites personnalisées
│   └── <action-name>/      # Dossier pour chaque action (avec action.yml et README.md)
├── workflows/              # Workflows réutilisables via 'workflow_call'
│   └── <workflow-name>/    # Dossier pour chaque workflow (avec workflow.yml et README.md)
├── .github/workflows/      # Workflows CI de ce dépôt (tests internes)
├── .editorconfig           # Convention de formatage partagée
├── LICENSE                 # Licence d'utilisation du code
├── CHANGELOG.md            # Journal des modifications
└── README.md               # Ce fichier
```

---

## 🔁 Utilisation d'une action composite

```yaml
# Exemple d'appel dans un job GitHub Actions
- name: Setup Node & pnpm
  uses: avenirs/avenirs-workflows/actions/install-node@v1
  with:
    node-version: '18'
    pnpm-version: '8'
```

---

## 🔁 Utilisation d’un workflow réutilisable

```yaml
# Exemple : .github/workflows/ci.yml dans un autre dépôt
name: CI

on:
  push:
    branches: [main]

jobs:
  call-reusable-workflow:
    uses: avenirs/avenirs-workflows/workflows/build-and-test/workflow.yml@v1
    with:
      project-name: my-app
    secrets:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 📦 Actions disponibles

| Nom                            | Description                                   |
|--------------------------------|-----------------------------------------------|
| `install-node`                 | Installe Node.js + pnpm                      |
| `setup-python-poetry`         | Installe Python + Poetry                     |

---

## 🧩 Workflows disponibles

| Nom              | Description                                    |
|------------------|------------------------------------------------|
| `build-and-test` | Build et tests automatisés d’un projet         |
| `docker-deploy`  | Déploiement Docker sur un serveur distant      |


