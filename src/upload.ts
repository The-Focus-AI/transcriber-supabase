// Make sure to include the following import:
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";
import * as path from "jsr:@std/path";
const geminiApiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");

// Take command line arguments
const args = Deno.args;
if (args.length < 1) {
  console.error("Please provide a media file path as an argument");
  Deno.exit(1);
}

const media = args[0];

await processAudioFile(media);

async function processAudioFile(media: string) {
  try {
    if (!geminiApiKey) {
      throw new Error("GOOGLE_GEMINI_API_KEY environment variable not set");
    }

    // Make sure to include the following import:
    // import {GoogleGenAI} from '@google/genai';
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const myfile = await ai.files.upload({
      file: media,
      config: { mimeType: "audio/mpeg" },
    });
    console.log("Uploaded file:", myfile);

    if (!myfile.uri || !myfile.mimeType) {
      throw new Error("Uploaded file does not have a valid URI or MIME type");
    }

    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: createUserContent([
        createPartFromUri(myfile.uri, myfile.mimeType),
        "Describe this audio clip",
      ]),
    });
    console.log("result.text=", result.text);
  } catch (error) {
    console.error("Error processing audio file:", error);
    throw error;
  }
}
