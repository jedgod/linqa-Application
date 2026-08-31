import type { FastifyInstance } from "fastify";
import { MetricsRegistry } from "./metrics-registry.js";

/**
 * Registers `/metrics` and returns the shared registry so feature modules
 * (Home news routing, feed aggregation) can emit into the same scrape.
 */
export function registerMetrics(app: FastifyInstance): MetricsRegistry {
  const registry = new MetricsRegistry();
  let requests = 0;
  let failures = 0;

  app.addHook("onResponse", async (_request, reply) => {
    requests += 1;
    if (reply.statusCode >= 500) failures += 1;
  });

  app.get("/metrics", async (_request, reply) => {
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send([
        "# HELP linqa_http_requests_total Total HTTP responses.",
        "# TYPE linqa_http_requests_total counter",
        `linqa_http_requests_total ${requests}`,
        "# HELP linqa_http_failures_total Total HTTP 5xx responses.",
        "# TYPE linqa_http_failures_total counter",
        `linqa_http_failures_total ${failures}`,
        ...registry.render(),
        ""
      ].join("\n"));
  });

  return registry;
}
