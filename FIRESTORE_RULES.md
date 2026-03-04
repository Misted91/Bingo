# Règles Firestore – Bingo Online

Collez ces règles dans Firebase Console → Firestore → Règles

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Bingo rooms
    match /bingo_rooms/{roomId} {
      // Anyone authenticated can read rooms
      allow read: if request.auth != null;

      // Only authenticated users can create rooms
      allow create: if request.auth != null;

      // Only the host can update room data
      allow update: if request.auth != null && (
        resource.data.host == request.auth.uid ||
        // Allow players to claim bingo (update winner)
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'winner', 'winnerName', 'calledNumbers'])
      );

      // Only host can delete room
      allow delete: if request.auth != null && resource.data.host == request.auth.uid;

      // Players subcollection
      match /players/{playerId} {
        // Anyone in the game can read players
        allow read: if request.auth != null;

        // Players can only write their own data
        allow write: if request.auth != null && request.auth.uid == playerId;

        // Host can delete any player doc (kick)
        allow delete: if request.auth != null && (
          request.auth.uid == playerId ||
          get(/databases/$(database)/documents/bingo_rooms/$(roomId)).data.host == request.auth.uid
        );
      }
    }
  }
}
```
