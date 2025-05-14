# 🛠️ Avenirs Workflows

Ce dépôt centralise les **actions composites** et **workflows GitHub réutilisables** de l'organisation **Avenirs**.
Il permet de standardiser, partager et maintenir une intégration continue (CI/CD) propre et cohérente entre tous les projets.

---

## 📁 Structure du dépôt

```
avenirs-workflows/
├── .github/
│    └──actions/            # Actions composites personnalisées
│       └── <action-name>/  # Dossier pour chaque action (avec action.yml)
│    └──workflows/          # Workflows réutilisables via 'workflow_call' avec nom_workflow.yaml
├── gh-page-template/       # Dossier contenant le template de la GitHub page générée
├── trivy-template/         # Dossier contenant le template utilisé pour le rapport de sécurité
├── .editorconfig           # Convention de formatage partagée
├── LICENSE                 # Licence d'utilisation du code
├── CHANGELOG.md            # Journal des modifications
└── README.md               # Ce fichier
```

---

## 🔁 Utilisation d'une action composite

```yaml
# Exemple d'appel dans un job GitHub Actions
- name: Setup Node
  uses: avenirs-esr/avenirs-workflows/.github/actions/install-node@main
  with:
    node-version: '22'
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
    uses: avenirs-esr/avenirs-workflows/.github/workflows/common-backend-workflow.yaml@main
    with:
      project-name: my-app
    secrets:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 📦 Actions disponibles

| Nom                            | Description                                                                             |
|--------------------------------|-----------------------------------------------------------------------------------------|
| `detect-project-type`          | Détecte automatiquement le type de projet.                                              |
| `gh-action-utils`              | Utilitaires pour les workflows GitHub.                                                  |
| `linting-scan`                 | Exécute des vérifications de linting.                                                   |
| `load-tests`                   | Exécute des tests de charge automatisés.                                                |
| `publish-to-gh-pages`          | Publie sur GitHub Pages.                                                                |
| `security-scan`                | Exécute une analyse de sécurité avec Trivy.                                             |
| `setup-cas`                    | Configure CAS (Central Authentication Service).                                         |
| `setup-google-java-format`     | Configure Google Java Format.                                                           |
| `setup-node`                   | Installe et configure Node.js et exécute un npm ci.                                     |
| `setup-openldap`               | Configure OpenLDAP.                                                                     |
| `setup-postgres`               | Installe et configure PostgreSQL.                                                       |
| `setup-trivy`                  | Installe Trivy pour les scans de sécurité.                                              |
| `spring-boot-app`              | Actions liées au start et stop d'une application Spring Boot.                           |
| `unit-tests-and-code-coverage` | Exécute les tests unitaires et génère la couverture de code.                            |
| `upload-templates`             | Action permettant l'upload des templates en tant qu'artefacts afin qu'ils soient disponibles pour les autres jobs. |

---

## 🧩 Workflows disponibles

| Nom                           | Description                                       |
|-------------------------------|---------------------------------------------------|
| `common-backend-workflow`     | Workflow commun pour les projets backend.         |
| `common-frontend-workflow`    | Workflow commun pour les projets frontend.        |
| `portfolio-security-workflow` | Workflow spécifique au projet portfolio sécurité. |
