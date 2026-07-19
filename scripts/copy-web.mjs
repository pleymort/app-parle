// Copie les fichiers de l'app web (source de vérité à la racine, aussi servie
// par GitHub Pages) vers www/, le dossier que Capacitor embarque dans l'app native.
// Lancé automatiquement avant chaque `cap sync` (voir package.json).
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const www = join(root, "www");
const files = ["index.html", "sw.js", "manifest.json", "icon.svg"];

await mkdir(www, { recursive: true });
for (const f of files) {
  await copyFile(join(root, f), join(www, f));
  console.log("copié → www/" + f);
}
console.log("✓ www/ prêt pour Capacitor");
