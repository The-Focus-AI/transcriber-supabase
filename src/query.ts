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
if (args.length < 2) {
  console.error("Please provide a google file path and a query as an argument");
  Deno.exit(1);
}

const media = args[0];
const query = args[1];

await ask(media, query);

async function ask(media: string, query: string) {
  try {
    if (!geminiApiKey) {
      throw new Error("GOOGLE_GEMINI_API_KEY environment variable not set");
    }

    // Make sure to include the following import:
    // import {GoogleGenAI} from '@google/genai';
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const myFile = await ai.files.get({ name: media });
    console.log("Got file:", myFile);

    if (!myFile.uri || !myFile.mimeType) {
      throw new Error("Uploaded file does not have a valid URI or MIME type");
    }

    const result = await ai.models.generateContentStream({
      model: "gemini-2.5-pro-preview-03-25",
      contents: createUserContent([
        createPartFromUri(myFile.uri, myFile.mimeType),
        query,
      ]),
      
    });

    let resultText = "";

    for await (const chunk of result) {
      resultText += chunk.text;
      console.log(chunk.text);
    }

    console.log(result);

    await Deno.writeTextFile("output.json", resultText);

  } catch (error) {

    console.error("Error processing audio file:", error);
    throw error;
  }
}
