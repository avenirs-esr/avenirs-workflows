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



