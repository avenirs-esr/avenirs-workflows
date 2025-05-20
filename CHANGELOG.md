# 📦 Changelog

Ce fichier suit tous les changements notables apportés à ce dépôt, selon le format [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et le standard [Conventional Commits](https://www.conventionalcommits.org/).

---

## [Unreleased]

### ✨ Added
- Initialisation du dépôt avec structure pour `actions` et `workflows`.

---

## [v1.0.1] - 2025-05-22

- Téléchargement du ar pour jasypt pour que l'action setup-postgres soit autonome.

## [v1.0.0] - 2025-05-14

### 🚀 Initial Release
- Première version stable avec premières actions composites et workflows.
- Ajout de la documentation de base dans le fichier `README.md`.
- Ajout des templates pour les pages GitHub et le rapport de sécurité Trivy.
- Ajout des actions composites :
  - `detect-project-type` : Détection automatique du type de projet.
  - `gh-action-utils` : Utilitaires pour les workflows GitHub.
  - `linting-scan` : Exécution de vérifications de linting.
  - `load-tests` : Tests de charge automatisés.
  - `publish-to-gh-pages` : Publication sur GitHub Pages.
  - `security-scan` : Analyse de sécurité avec Trivy.
  - `setup-cas` : Configuration de CAS (Central Authentication Service).
  - `setup-google-java-format` : Configuration de Google Java Format.
  - `setup-node` : Installation et configuration de Node.js avec npm ci.
  - `setup-openldap` : Configuration de OpenLDAP.
  - `setup-postgres` : Installation et configuration de PostgreSQL.
  - `setup-trivy` : Installation de Trivy pour les scans de sécurité.
  - `spring-boot-app` : Start et stop d'une application Spring Boot.
  - `unit-tests-and-code-coverage` : Exécution des tests unitaires et génération de la couverture de code.
  - `upload-templates` : Upload des templates en tant qu'artefacts pour les autres jobs.
- Ajout des workflows réutilisables :
  - `common-backend-workflow` : Workflow commun pour les projets backend.
  - `common-frontend-workflow` : Workflow commun pour les projets frontend.
  - `portfolio-security-workflow` : Workflow spécifique au projet portfolio sécurité.
