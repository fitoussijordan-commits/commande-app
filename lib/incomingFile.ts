// lib/incomingFile.ts
// Fichiers ouverts DANS l'app depuis iOS : Mail → pièce jointe → partager (flèche
// vers le haut) → « Commande ». Info.plist déclare les PDF et les photos
// (CFBundleDocumentTypes) ; iOS copie alors le fichier dans Documents/Inbox et
// ouvre l'app avec son URL file://.
//
// Le fichier peut arriver avant que l'écran de commande existe (app lancée à
// froid, ou commercial pas encore connecté) : il est gardé en attente jusqu'à ce
// qu'un écran s'abonne.

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

let started = false;
let pending: File | null = null;
const listeners = new Set<(f: File) => void>();

async function receive(url: string) {
  if (!url || !url.startsWith("file:")) return;
  try {
    // convertFileSrc → URL servie par Capacitor au WebView, lisible par fetch.
    const blob = await fetch(Capacitor.convertFileSrc(url)).then(r => r.blob());
    const name = decodeURIComponent(url.split("/").pop() || "document");
    const file = new File([blob], name, { type: blob.type });
    if (listeners.size) listeners.forEach(cb => cb(file));
    else pending = file;
  } catch {
    // Fichier illisible : rien à faire, le commercial peut l'importer à la main.
  }
}

// À appeler une fois au démarrage, avant la connexion (sinon un fichier ouvert
// depuis l'écran de connexion serait perdu).
export function initIncomingFiles() {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  App.getLaunchUrl().then(r => { if (r?.url) void receive(r.url); }).catch(() => {});
  App.addListener("appUrlOpen", e => { void receive(e.url); }).catch(() => {});
}

// S'abonne aux fichiers reçus ; délivre tout de suite celui en attente.
export function onIncomingFile(cb: (f: File) => void): () => void {
  listeners.add(cb);
  if (pending) { const f = pending; pending = null; cb(f); }
  return () => { listeners.delete(cb); };
}
