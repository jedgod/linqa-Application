import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import {
  AiWorkerService,
  FailClosedConfidentialAiProvider
} from "../services/ai-worker.service.js";

const config = loadConfig();
const db = createPool(config);
const worker = new AiWorkerService(
  db,
  new FailClosedConfidentialAiProvider()
);

try {
  const workerId = `ai-worker:${process.pid}`;
  const result = await worker.execute(workerId);
  console.log(result);
} finally {
  await db.end();
}
