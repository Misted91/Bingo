j'aimerais que l'hôte puisse choisir les paramètres c'est à dire tirage automatique ou non des chiffres, nombre de grille par personne temps que met les chiffres à s'écouler les différents paterns possibles pour gagner des points etc, j'aimerais que tout se fasse sans avoir à faire f5, le fond est déplacé quelques secondes après le lancement, j'aimerais que un coup que nous avons le chiffre sur notre grille tu ajoute une option à la partie pour activer les animations .called, j'aimerais que toutes les pages soient comprises et visibles entièrement à l'écran sans avoir à scroll surtout pour la partie en cours, ajoute un chat à chaque partie y compris dans le menu d'attente, renomme le site non plus en "BingoOnline" mais en "BingOnline" pour faire la liaison entre les deux mots, le logo du titre doit faire la même taille en hauteur que le titre en lui même et avoit la même couleur que le mot "Online", j'aimerais dans les paramètres de la partie une option qui permet de choisir si les joueurs doivent valider manuellement ou non un type de bingo et le quel (pense à mettre un aperçu de ce qui est demandé aussi), j'aimerais pouvoir quitter une partie et juste en F5 revenir dessus direct pas retaper le code de la partie, je ne veux plus utiliser les popups natives des navigateurs mais des popup modal dans le site, pense au fait que tout doit être rgpd friendly, j'aimerais que tu pense à faire en sorte que tout soit responsive et dynamique, pense à modifier à la fin le readme par rapport à ce que tu a fait


# firestore

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    match /bingo_rooms/{roomId} {
      // Tout utilisateur connecté peut lire les rooms (nécessaire pour les rooms publiques + rejoindre par code)
      allow read: if request.auth != null;

      // Création : tout utilisateur connecté peut créer une room
      allow create: if request.auth != null
        && request.resource.data.host == request.auth.uid;

      // Mise à jour : seul l'hôte peut modifier la room (settings, status, calledNumbers, winner…)
      allow update: if request.auth != null
        && resource.data.host == request.auth.uid;

      // Suppression : seul l'hôte OU tout utilisateur connecté si la room est terminée/vide
      allow delete: if request.auth != null
        && (resource.data.host == request.auth.uid
            || resource.data.status == 'finished');

      // --- Sous-collection : players ---
      match /players/{playerId} {
        allow read: if request.auth != null;

        // Un joueur peut s'ajouter lui-même
        allow create: if request.auth != null
          && playerId == request.auth.uid;

        // Un joueur peut modifier ses propres données (marked, markedGrids, hasBingo)
        allow update: if request.auth != null
          && playerId == request.auth.uid;

        // Un joueur peut se supprimer lui-même, ou l'hôte peut supprimer n'importe quel joueur (cleanup)
        allow delete: if request.auth != null
          && (playerId == request.auth.uid
              || get(/databases/$(database)/documents/bingo_rooms/$(roomId)).data.host == request.auth.uid);
      }

      // --- Sous-collection : messages (chat) ---
      match /messages/{messageId} {
        allow read: if request.auth != null;

        // Tout joueur connecté peut envoyer un message
        allow create: if request.auth != null
          && request.resource.data.uid == request.auth.uid;

        // Suppression autorisée pour le cleanup
        allow delete: if request.auth != null;
      }

      // --- Sous-collection : typing (indicateur de frappe) ---
      match /typing/{typingId} {
        allow read: if request.auth != null;

        // Un joueur peut créer/modifier son propre indicateur de frappe
        allow create, update: if request.auth != null
          && typingId == request.auth.uid;

        // Suppression autorisée (cleanup + déconnexion)
        allow delete: if request.auth != null;
      }
    }

    // Bloquer tout le reste
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```