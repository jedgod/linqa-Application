// Lets `node --import ./tests/ts-resolve.mjs --test` load extensionless relative
// TypeScript imports (as tsc/Metro resolve them) without changing app sources.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (specifier.startsWith(".") && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
          throw error;
        }
      }
    `)
);
