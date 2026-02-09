import fs from "node:fs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../apps/common/src/db.js";
import { resetEnvForTests } from "../apps/common/src/env.js";
import { createSsrApp } from "../apps/ssr/src/server.js";
import { runMigration } from "../db/migrate.js";

const TEST_DB_PATH = "./db/test-api.db";

describe("Producer API", () => {
  beforeEach(async () => {
    resetDbForTests();
    resetEnvForTests();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    process.env.SQLITE_DB_PATH = TEST_DB_PATH;
    process.env.PRODUCER_API_TOKEN = "token-123";
    process.env.SITE_BASE_URL = "http://localhost:3000";

    await runMigration();
  });

  afterAll(() => {
    resetDbForTests();
    resetEnvForTests();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("rejects unauthorized requests", async () => {
    const app = createSsrApp();

    const response = await request(app)
      .post("/api/producer/run")
      .set("x-idempotency-key", "a1")
      .send({ topic: "t", city: "c", keyword: "k" });

    expect(response.status).toBe(401);
  });

  it("rejects missing idempotency key", async () => {
    const app = createSsrApp();

    const response = await request(app)
      .post("/api/producer/run")
      .set("authorization", "Bearer token-123")
      .send({ topic: "t", city: "c", keyword: "k" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("missing x-idempotency-key");
  });

  it("rejects invalid payload", async () => {
    const app = createSsrApp();

    const response = await request(app)
      .post("/api/producer/run")
      .set("authorization", "Bearer token-123")
      .set("x-idempotency-key", "a2")
      .send({ topic: "", city: "c", keyword: "k" });

    expect(response.status).toBe(400);
  });
});
