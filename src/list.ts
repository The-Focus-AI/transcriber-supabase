// Make sure to include the following import:
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY"); 

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

console.log("My files:");
// Using the pager style to list files

const pager = await ai.files.list({ config: { pageSize: 10 } });
let page = pager.page;
const names = [];
while (true) {
  for (const f of page) {
    console.log("  ", f.name);
    names.push(f.name);
  }
  if (!pager.hasNextPage()) break;
  page = await pager.nextPage();
}
