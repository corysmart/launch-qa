import { createServer as createHttpServer } from "node:http";
import { generateReviewReport, UpstreamFetchError, ValidationError } from "./lib/review.js";

const MAX_BODY_SIZE_BYTES = 1024 * 1024;

export async function handleRoute({ method, url, body }, options = {}) {
  try {
    if (method === "GET" && url === "/health") {
      return {
        statusCode: 200,
        payload: { ok: true }
      };
    }

    if (method === "POST" && url === "/api/review") {
      const report = await generateReviewReport(body, options);
      return {
        statusCode: 200,
        payload: { ok: true, report }
      };
    }

    return {
      statusCode: 404,
      payload: {
        ok: false,
        error: "Not Found"
      }
    };
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    const message =
      error instanceof ValidationError || error instanceof UpstreamFetchError
        ? error.message
        : "Unexpected server error.";

    return {
      statusCode,
      payload: {
        ok: false,
        error: message
      }
    };
  }
}

export function createServer(options = {}) {
  return createHttpServer(async (request, response) => {
    try {
      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      const { statusCode, payload } = await handleRoute(
        {
          method: request.method,
          url: request.url,
          body
        },
        options
      );

      sendJson(response, statusCode, payload);
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      const message = error instanceof ValidationError ? error.message : "Unexpected server error.";

      sendJson(response, statusCode, {
        ok: false,
        error: message
      });
    }
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_SIZE_BYTES) {
      throw new ValidationError("Request body exceeds the 1 MB v1 limit.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new ValidationError("Request body must not be empty.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const server = createServer();

  server.listen(port, () => {
    console.log(`Launch QA listening on http://localhost:${port}`);
  });
}
