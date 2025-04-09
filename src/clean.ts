// src/clean.ts
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");

if (!geminiApiKey) {
  console.error("Error: GOOGLE_GEMINI_API_KEY environment variable not set.");
  Deno.exit(1);
}

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

console.log("Deleting all stored files...");

let deletedCount = 0; // Declare outside try for final log

try {
  // Using the pager style to list files
  const pager = await ai.files.list({ config: { pageSize: 50 } });
  let page = pager.page;

  while (true) {
    const deletePromises = []; // Reset promises for each page
    for (const f of page) {
      if (f.name) {
        console.log(`  Deleting file: ${f.name} (${f.displayName || 'N/A'})`);
        // Correctly pass the file name as an object
        deletePromises.push(ai.files.delete({ name: f.name }).catch(err => {
          // Check if err is an Error object before accessing message
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`  Failed to delete ${f.name}:`, errorMessage);
          // Don't stop the whole process if one file fails
        }));
      } else {
        console.warn("  Skipping file with undefined name.");
      }
    } // End of for loop

    // Wait for all delete operations on the current page to complete
    if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
        // Only count files we attempted to delete on this page
        // Note: This counts attempts, not necessarily successes if catch block was hit
        deletedCount += deletePromises.length;
    }


    if (!pager.hasNextPage()) break;
    page = await pager.nextPage();
  } // End of while loop

  console.log(`\nFinished processing files. Total files processed for deletion: ${deletedCount}`);

} catch (error) {
  // Check if error is an Error object before accessing message
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("An error occurred during the file deletion process:", errorMessage);
  if (error instanceof Error && error.stack) {
      console.error(error.stack);
  }
  Deno.exit(1);
}