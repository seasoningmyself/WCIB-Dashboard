import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { createApp } from "./app.js";

class MemorySocket extends Duplex {
  readonly chunks: Buffer[] = [];

  _read(): void {}

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    );
    callback();
  }
}

async function request(path: string): Promise<{
  body: unknown;
  statusCode: number;
}> {
  const socket = new MemorySocket();
  const nodeSocket = socket as unknown as Socket;
  const req = new IncomingMessage(nodeSocket);
  const res = new ServerResponse(req);

  req.method = "GET";
  req.url = path;
  req.headers = { host: "localhost" };
  res.assignSocket(nodeSocket);

  const finished = new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
  });

  createApp()(req, res);
  await finished;

  const rawResponse = Buffer.concat(socket.chunks).toString("utf8");
  const body = rawResponse.split("\r\n\r\n", 2)[1];

  return {
    body: JSON.parse(body),
    statusCode: res.statusCode,
  };
}

test("GET /api returns backend status", async () => {
  const response = await request("/api");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    name: "WCIB Dashboard API",
    status: "ok",
  });
});
