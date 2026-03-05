# 🎱 BingOnline

**Joue au Bingo en ligne avec tes amis, gratuitement et sans inscription compliquée.**

🌐 **[bingo.bryan.ovh](https://bingo.bryan.ovh)**

---

## 🕹️ Comment jouer

1. **Connecte-toi** avec ton compte Google (bouton dans la barre de navigation)
2. **Crée une room** ou **rejoins** celle d'un ami avec un code à 6 lettres
3. Attends que tout le monde soit dans la salle d'attente
4. L'hôte configure les paramètres et clique sur **Lancer la partie**
5. À chaque tirage, clique sur le numéro correspondant sur ta grille pour le marquer
6. Complète le pattern demandé et clique sur **BINGO !** pour gagner 🎉

---

## ✨ Fonctionnalités

- 🔐 **Connexion Google** en un clic — bouton directement dans le header
- 🏠 **Rooms privées** avec code à 6 caractères — jusqu'à **8 joueurs**
- 🌍 **Rooms publiques** — visibles par tous les joueurs connectés (configurable par l'hôte)
- 🔒 **Masquage du code** — option streamer pour cacher le code de la room
- ⏳ **Salle d'attente** en temps réel avec liste de joueurs animée
- 💬 **Chat en temps réel** dans la salle d'attente et pendant la partie (activable/désactivable par l'hôte)
- ⌨️ **Indicateur « est en train d'écrire »** dans le chat
- 🔄 **Reprise de session automatique** (F5 / rechargement de page)
- 📐 **Taille de grille configurable** — de 3×3 à 7×7 (défaut 5×5 classique B·I·N·G·O)
- 📋 **Multi-grilles** — de 1 à 4 grilles par joueur
- ⚡ **Tirage instantané** — tous les joueurs voient le numéro en même temps
- 🎰 **Mode tirage automatique** avec intervalle configurable (3–60 s)
- 🖱️ **Marquage en un clic** avec surbrillance des numéros tirés
- ✨ **Animations sur les numéros tirés** (activables/désactivables)
- 🔍 **Détection automatique** des patterns gagnants
- 🏆 **Patterns gagnants configurables** : Ligne, Colonne, Diagonale, 4 Coins, Carton plein, Croix (X)
- 🤝 **Validation manuelle du Bingo** — les joueurs votent pour valider un Bingo
- 🎊 **Animation de victoire** avec confettis
- 👁️ **Paramètres visibles par tous** — les non-hôtes voient les réglages (en lecture seule)
- 🗑️ **Nettoyage automatique** — les rooms vides ou terminées sont supprimées après 1 minute
- 🎨 **Scrollbars personnalisées** — design cohérent avec le thème
- 📱 **100% responsive** — jouable sur ordinateur, tablette et téléphone
- 🌙 **Interface moderne** avec thème sombre et effets glassmorphism

---

## 🔒 Confidentialité (RGPD)

BingOnline utilise Firebase Authentication (Google) pour vous identifier. Seuls votre nom d'affichage et votre photo de profil sont récupérés.

Vos données de jeu (grilles, marquages, statut), les messages du chat et les indicateurs de frappe sont stockés temporairement dans Cloud Firestore le temps de la partie. Les rooms terminées ou vides sont automatiquement supprimées après 1 minute d'inactivité, incluant toutes les sous-collections (joueurs, messages, indicateurs de frappe).

Si l'hôte choisit la visibilité « publique », le nom de l'hôte et le code de la room sont visibles par les autres joueurs connectés.

Aucun cookie publicitaire, traceur ou outil d'analyse n'est utilisé. Aucune donnée n'est vendue ni partagée avec des tiers.

---

## 🛠️ Technologies

| | |
|---|---|
| Frontend | HTML · CSS · JavaScript (vanilla) |
| Auth | Firebase Authentication (Google) |
| Temps réel | Cloud Firestore |
| Icônes | [Lucide](https://lucide.dev/) · [Simple Icons](https://simpleicons.org/) |
| Police | [Outfit](https://fonts.google.com/specimen/Outfit) |
| Hébergement | GitHub Pages |

---

## 📁 Structure des fichiers

```
├── index.html          # Page lobby (connexion, création/rejoint room, rooms publiques)
├── game.html           # Page de jeu (grille dynamique, tirage, chat, bingo)
├── css/
│   ├── base.css        # Variables, reset, layout global, scrollbars, keyframes
│   ├── components.css  # Header, auth, boutons, toast, modal, footer RGPD
│   ├── lobby.css       # Lobby, salle d'attente, settings, joueurs, chat, rooms publiques
│   └── game.css        # Grille bingo (multi-taille), sidebar, chat jeu, overlay gagnant
├── js/
│   ├── firebase-config.js  # Initialisation Firebase
│   ├── ui-helpers.js       # Toast, modal confirm, modal RGPD
│   ├── bingo-utils.js      # Génération de grilles dynamiques (3×3 à 7×7), utilitaires
│   ├── auth.js             # Authentification Google (header, lobby)
│   ├── lobby.js            # Rooms, settings, chat, typing, rooms publiques, auto-cleanup
│   └── game.js             # Logique de jeu, tirage dynamique, Bingo, chat, validation
└── README.md
```

---

## 🔥 Firestore Security Rules

Les règles de sécurité recommandées sont documentées dans la section ci-dessous. Voir la console Firebase > Firestore > Rules pour les appliquer.

---

## 📜 Licence

Projet personnel de [Misted91](https://github.com/Misted91).
