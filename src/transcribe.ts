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
  console.error("Please provide a google file path and a query as an argument");
  Deno.exit(1);
}

const media = args[0];

const output_schema = {
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "timestamp": {
            "type": "string",
            "description": "mm:ss"
          },
          "ad": {
            "type": "boolean"
          },
          "speaker": {
            "type": "string"
          },
          "text": {
            "type": "string"
          },
          "tone": {
            "type": "string",
            "description": "the conversation tone"
          }
        },
        "required": [
          "timestamp",
          "ad",
          "speaker",
          "text",
          "tone"
        ]
      }
    }
  },
  "required": [
    "items"
  ]
}

async function transcribe(media: string) {
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
        "transcribe into this format: " + JSON.stringify(output_schema),
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


await transcribe(media);