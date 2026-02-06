import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { getEnv } from "../../common/src/env.js";

const env = getEnv();

export const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model(env.GENKIT_MODEL),
  promptDir: "./apps/producer/prompts",
});

export { z };
