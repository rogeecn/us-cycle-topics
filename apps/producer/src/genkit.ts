import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { openAICompatible } from "@genkit-ai/compat-oai";
import { getEnv } from "../../common/src/env.js";

const env = getEnv();
const compatProviderName = "compat";
const useCompatProvider = Boolean(env.GENKIT_BASEURL);

const plugins = useCompatProvider
  ? [
      openAICompatible({
        name: compatProviderName,
        apiKey: process.env.OPENAI_API_KEY ?? "compat-placeholder",
        baseURL: env.GENKIT_BASEURL!,
      }),
    ]
  : [googleAI()];

const resolvedModel = useCompatProvider
  ? env.GENKIT_MODEL.includes("/")
    ? env.GENKIT_MODEL
    : `${compatProviderName}/${env.GENKIT_MODEL}`
  : env.GENKIT_MODEL;

export const ai = genkit({
  plugins,
  model: resolvedModel,
  promptDir: "./apps/producer/prompts",
});

export { z };
