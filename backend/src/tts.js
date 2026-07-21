import textToSpeech from "@google-cloud/text-to-speech";
import { Storage } from "@google-cloud/storage";
import { createHash } from "node:crypto";
import { config } from "./config.js";
import { normLang, voiceFor } from "./lang.js";

const ttsClient = new textToSpeech.TextToSpeechClient();
const storage = new Storage();

/* Synthèse vocale avec cache Cloud Storage mutualisé :
   clé = sha256(voix + texte) → un mot généré une fois sert à tous.
   La voix dépend de la langue → les langues ne se mélangent jamais dans le cache.
   Sortie : WAV (LINEAR16 24 kHz), directement jouable par l'app. */
export async function tts(text, lang) {
  const langCode = normLang(lang);
  const voice = voiceFor(langCode);
  const key =
    createHash("sha256").update(voice + "|" + text).digest("hex") + ".wav";
  const bucket = config.ttsBucket ? storage.bucket(config.ttsBucket) : null;

  if (bucket) {
    const file = bucket.file(key);
    const [exists] = await file.exists();
    if (exists) {
      const [buf] = await file.download();
      return { buf, cached: true };
    }
  }

  const [res] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: langCode, name: voice },
    audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
  });
  const buf = Buffer.from(res.audioContent);

  if (bucket) {
    // Mise en cache en tâche de fond — un échec de cache ne bloque pas la voix
    bucket.file(key).save(buf, { contentType: "audio/wav" })
      .catch((e) => console.error("tts cache:", e.message));
  }
  return { buf, cached: false };
}
