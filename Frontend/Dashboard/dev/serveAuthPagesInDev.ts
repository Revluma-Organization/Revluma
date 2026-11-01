import { createReadStream, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Serve the legacy authentication pages and shared assets from
 * the Dashboard Vite origin during local development only.
 *
 * Production hosting and authentication routes are unchanged.
 */
export function serveAuthPagesInDev(): Plugin {
  return {
    name: "revluma-local-auth-pages",
    apply: "serve",

    configureServer(server) {
      const frontendRoot = path.resolve(server.config.root, "..");

      const mimeTypes: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".gif": "image/gif",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
      };

      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return next();
        }

        let pathname: string;

        try {
          pathname = decodeURIComponent(
            new URL(req.url ?? "/", "http://localhost").pathname
          );
        } catch {
          return next();
        }

        if (
          !pathname.startsWith("/auth/") &&
          !pathname.startsWith("/assets/")
        ) {
          return next();
        }

        let filePath = path.resolve(
          frontendRoot,
          pathname.slice(1)
        );

        // Login pages remove .html from their URL after loading.
        if (
          pathname.startsWith("/auth/") &&
          !path.extname(filePath)
        ) {
          filePath += ".html";
        }

        if (!filePath.startsWith(frontendRoot + path.sep)) {
          return next();
        }

        let resolved: string;

        try {
          resolved = realpathSync(filePath);

          if (
            !resolved.startsWith(frontendRoot + path.sep) ||
            !statSync(resolved).isFile()
          ) {
            return next();
          }
        } catch {
          return next();
        }

        const mimeType = mimeTypes[path.extname(resolved).toLowerCase()];

        if (!mimeType) {
          return next();
        }

        res.setHeader("Content-Type", mimeType);
        res.setHeader("Cache-Control", "no-store");

        if (req.method === "HEAD") {
          res.end();
          return;
        }

        createReadStream(resolved)
          .on("error", () => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end("Unable to serve local frontend file.");
            } else {
              res.destroy();
            }
          })
          .pipe(res);
      });
    },
  };
}
