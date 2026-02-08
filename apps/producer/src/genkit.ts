import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { getEnv } from "../../common/src/env.js";

const env = getEnv();
const compatProviderName = "compat";

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
  promptDir: "./apps/producer/prompts",
});

export { z };
