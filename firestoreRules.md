# rules firestore

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    match /bingo_rooms/{roomId} {
      // Lecture publique (nécessaire pour le spectateur non connecté)
      allow read: if true;

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
        // Lecture publique (spectateur voit les grilles)
        allow read: if true;

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
        // Lecture publique (spectateur voit le chat)
        allow read: if true;

        // Tout joueur connecté peut envoyer un message
        allow create: if request.auth != null
          && request.resource.data.uid == request.auth.uid;

        // Suppression autorisée pour le cleanup
        allow delete: if request.auth != null;
      }

      // --- Sous-collection : typing (indicateur de frappe) ---
      match /typing/{typingId} {
        // Lecture publique
        allow read: if true;

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