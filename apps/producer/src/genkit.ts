import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { getEnv } from "../../common/src/env.js";

const env = getEnv();
const compatProviderName = "compat";

if (!env.GENKIT_MODEL.includes("/")) {
  throw new Error(
    "GENKIT_MODEL must include provider prefix (for example: googleai/gemini-2.5-flash or compat/gpt-4o-mini)",
  );
}

const plugins = [googleAI()];
if (env.GENKIT_BASEURL) {
  plugins.push(
    openAICompatible({
      name: compatProviderName,
      apiKey: process.env.OPENAI_API_KEY ?? "compat-placeholder",
      baseURL: env.GENKIT_BASEURL,
    }),
  );
}

export const ai = genkit({
  plugins,
  model: env.GENKIT_MODEL,
  promptDir: "./apps/producer/prompts",
});

export { z };
