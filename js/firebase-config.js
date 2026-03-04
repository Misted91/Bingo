/**
 * Firebase configuration and initialization — shared by all pages
 */
const firebaseConfig = {
    apiKey: "AIzaSyBQOObCmTNS3d-H8_1hQbpcyTugUhb00aY",
    authDomain: "bingo-c7caf.firebaseapp.com",
    projectId: "bingo-c7caf",
    storageBucket: "bingo-c7caf.firebasestorage.app",
    messagingSenderId: "824394390490",
    appId: "1:824394390490:web:5c068729ab49b0037d7ee3"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
