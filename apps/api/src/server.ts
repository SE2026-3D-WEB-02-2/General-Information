import http from 'node:http';
import { URL } from 'node:url';
import { MAX_API_JSON_BODY_BYTES, SpriterApiApplication } from './http/app-router.ts';

export function startSpriterHttpServer(port = Number(process.env.PORT ?? 4000)) {
  const app = new SpriterApiApplication();

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const contentLengthHeader = req.headers['content-length']
      ? Number(req.headers['content-length'])
      : 0;
    const contentType = req.headers['content-type'] ?? '';

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_API_JSON_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            errorCode: 'PAYLOAD_TOO_LARGE',
            message: `Request body exceeds ${MAX_API_JSON_BODY_BYTES} bytes. Upload .glb files via presigned URL.`,
          }),
        );
        return;
      }
      chunks.push(buf);
    }

    let parsedBody: unknown = undefined;
    if (chunks.length > 0 && contentType.includes('application/json')) {
      try {
        parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            errorCode: 'VALIDATION_FAILED',
            message: 'Malformed JSON request body.',
          }),
        );
        return;
      }
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const query: Record<string, string | undefined> = {};
    for (const [k, v] of parsedUrl.searchParams.entries()) {
      query[k] = v;
    }

    const response = await app.handleRequest({
      method: (req.method ?? 'GET') as any,
      path: parsedUrl.pathname,
      query,
      headers: {
        authorization: req.headers.authorization,
        contentType,
        contentLength: Math.max(contentLengthHeader, totalBytes),
      },
      body: parsedBody,
    });

    res.writeHead(response.statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.body));
  });

  server.listen(port, () => {
    console.log(`🚀 Spriter Backend API listening on http://localhost:${port}`);
  });

  return { server, app };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSpriterHttpServer();
}
