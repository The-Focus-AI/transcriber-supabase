import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const DEFAULT_ACCEPT_HEADER = 'audio/mpeg, audio/wav, audio/*;q=0.9, */*;q=0.8';

interface HeaderConfig {
    description: string;
    headers: HeadersInit | undefined; // undefined means use fetch default
}

async function attemptDownload(url: string, config: HeaderConfig, attemptIndex: number): Promise<boolean> {
    console.log(`\n--- Attempt ${attemptIndex + 1}: ${config.description} ---`);
    console.log(`URL: ${url}`);
    console.log(`Headers: ${config.headers ? JSON.stringify(config.headers) : 'Default'}`);

    try {
        const response = await fetch(url, { headers: config.headers });

        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log("Response Headers:");
        for (const [key, value] of response.headers.entries()) {
            console.log(`  ${key}: ${value}`);
        }

        if (response.ok) {
            console.log("Download appears successful (Status 2xx).");
            const blob = await response.blob();
            const filename = `temp_download_${attemptIndex + 1}.dat`; // Use a generic extension
            const filePath = join(Deno.cwd(), filename);
            await Deno.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
            console.log(`Successfully saved ${blob.size} bytes to ${filePath}`);
            return true;
        } else {
            console.log(`Download failed (Status ${response.status}).`);
            // Log body snippet for debugging if not successful but has body
            try {
                 const bodyText = await response.text();
                 console.log(`Response Body Snippet (up to 500 chars):\n${bodyText.substring(0, 500)}`);
            } catch (bodyErr) {
                 console.log("Could not read response body:", bodyErr instanceof Error ? bodyErr.message : String(bodyErr));
            }
            return false;
        }
    } catch (err) {
        console.error(`Error during fetch attempt: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

async function main() {
    const args = parse(Deno.args);
    const audioUrl = args._[0];

    if (typeof audioUrl !== 'string' || !audioUrl) {
        console.error("Usage: deno run --allow-net --allow-write src/test_download.ts <audio_url>");
        console.error("Example: deno run --allow-net --allow-write src/test_download.ts \"https://example.com/audio.mp3\"");
        Deno.exit(1);
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(audioUrl);
    } catch (e) {
        console.error(`Invalid URL provided: ${audioUrl}`);
        console.error(e instanceof Error ? e.message : String(e));
        Deno.exit(1);
    }

    const headerConfigs: HeaderConfig[] = [
        {
            description: "Deno Default Headers",
            headers: undefined,
        },
        {
            description: "User-Agent Only",
            headers: { 'User-Agent': DEFAULT_USER_AGENT },
        },
        {
            description: "User-Agent + Referer (Origin)",
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Referer': parsedUrl.origin,
            },
        },
        {
            description: "User-Agent + Referer + Accept (Audio)",
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Referer': parsedUrl.origin,
                'Accept': DEFAULT_ACCEPT_HEADER,
            },
        },
         {
            description: "User-Agent + Accept (Audio) - No Referer",
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': DEFAULT_ACCEPT_HEADER,
            },
        },
    ];

    console.log(`Testing download for URL: ${audioUrl}`);
    let success = false;
    for (let i = 0; i < headerConfigs.length; i++) {
        if (await attemptDownload(audioUrl, headerConfigs[i], i)) {
            success = true;
            console.log(`\nSUCCESS: Download succeeded with configuration: ${headerConfigs[i].description}`);
            // Optional: break here if you only need the first successful method
            // break;
        }
    }

    if (!success) {
        console.log("\nRESULT: All download attempts failed.");
    }
}

if (import.meta.main) {
    await main();
}