import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, GithubAuthProvider, FacebookAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBWRLYkGyOMZFl1_GRmiLxSa_jv_e0g27k",
  authDomain: "soundlist-57afb.firebaseapp.com",
  projectId: "soundlist-57afb",
  storageBucket: "soundlist-57afb.firebasestorage.app",
  messagingSenderId: "250988898190",
  appId: "1:250988898190:web:a2c60289ad5dc7a6c8a6df",
  measurementId: "G-FDSQNC3E3N"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const providers = {
  google: new GoogleAuthProvider(),
  github: new GithubAuthProvider(),
  facebook: new FacebookAuthProvider()
};

export const signInWithSocial = async (providerName) => {
  const provider = providers[providerName];
  if (!provider) throw new Error("Unknown provider");
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    throw error;
  }
};
