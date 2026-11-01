import net from "node:net";
import postgres from "postgres";

const frame = (type, body) => {
  const message = Buffer.alloc(5 + body.length);
  message.write(type);
  message.writeInt32BE(4 + body.length, 1);
  Buffer.from(body).copy(message, 5);
  return message;
};

// Loopback-only transport for the real Postgres.js driver and PGlite's actual
// PostgreSQL protocol engine. SQL, parameter discovery and binding are not mocked.
// The startup handshake is local scaffolding, not an authentication/TLS test.
export async function withPostgresClient(db, run) {
  const sockets = new Set();
  let protocolFailure;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let started = false,
      buffer = Buffer.alloc(0),
      queue = Promise.resolve();
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!started) {
        if (buffer.length < 4 || buffer.length < buffer.readInt32BE(0)) return;
        buffer = buffer.subarray(buffer.readInt32BE(0));
        started = true;
        socket.write(
          Buffer.concat([
            frame("R", Buffer.alloc(4)),
            frame("S", Buffer.from("server_version\x0017.0\x00")),
            frame("S", Buffer.from("client_encoding\x00UTF8\x00")),
            frame("Z", Buffer.from("I")),
          ]),
        );
      }
      while (buffer.length >= 5 && buffer.length >= 1 + buffer.readInt32BE(1)) {
        const length = 1 + buffer.readInt32BE(1),
          message = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        if (message[0] === 88) {
          socket.end();
          continue;
        }
        queue = queue
          .then(async () => {
            const result = await db.execProtocolRaw(message, {
              syncToFs: false,
            });
            if (result.length) socket.write(result);
          })
          .catch((error) => {
            protocolFailure = error;
            socket.destroy();
          });
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const sql = postgres({
    host: "127.0.0.1",
    port: server.address().port,
    user: "postgres",
    database: "postgres",
    ssl: false,
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 5,
    idle_timeout: 2,
  });
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 1 });
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (protocolFailure) throw protocolFailure;
  }
}
