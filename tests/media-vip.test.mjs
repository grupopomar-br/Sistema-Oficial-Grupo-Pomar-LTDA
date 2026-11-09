import { test } from "node:test";
import assert from "node:assert/strict";
import { pomarFixture } from "./helpers/pomar-fixture.mjs";
import { newBase } from "../src/lib/domain/model.ts";
import { mediaMetadata, metadataForFile } from "../src/lib/media/contracts.ts";
import { matchesMediaSignature } from "../src/lib/media/signature.ts";
import {
  mediaUploadUrl,
  mediaDownloadUrl,
  verifyMediaObject,
} from "../src/lib/media/r2.ts";
import { parseMediaConfig } from "../src/lib/config/media.ts";

const account = "a".repeat(32);
const config = parseMediaConfig({
  NODE_ENV: "production",
  POMAR_ENVIRONMENT: "production",
  NEXT_PUBLIC_APP_URL: "https://central.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_exampleexampleexample",
  POMAR_OWNER_USER_ID: "11111111-1111-4111-8111-111111111111",
  POMAR_MEDIA_ENABLED: "true",
  POMAR_R2_ACCOUNT_ID: account,
  POMAR_R2_MEDIA_BUCKET: "vip-test",
  POMAR_R2_ACCESS_KEY_ID: "b".repeat(32),
  POMAR_R2_SECRET_ACCESS_KEY: "c".repeat(64),
  POMAR_MEDIA_DATABASE_URL:
    "postgresql://pomar_media_worker.abcdefghijklmnopqrst:fixture@aws-0.example.pooler.supabase.com:6543/postgres",
});
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex",
);
const item = {
  fileName: "Referência.png",
  contentType: "image/png",
  sizeBytes: png.length,
};

test("Área VIP limita tipos, rejeita caminhos e diferencia HEIC, JPG, WebP e vídeo", () => {
  assert.equal(
    metadataForFile({ name: "Imagem.HEIC", size: 999 }).contentType,
    "image/heic",
  );
  for (const value of [
    { ...item, fileName: "../imagem.png" },
    { ...item, fileName: "png" },
    { ...item, fileName: "imagem.svg" },
    { ...item, sizeBytes: 30_000_001 },
    { ...item, contentType: "video/mp4" },
  ])
    assert.equal(mediaMetadata.safeParse(value).success, false);
  const ftyp = (brand) =>
    Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from(`ftyp${brand}`),
      Buffer.alloc(4),
    ]);
  assert.equal(matchesMediaSignature("image/heic", ftyp("heic")), true);
  assert.equal(matchesMediaSignature("image/heic", ftyp("avif")), false);
  assert.equal(matchesMediaSignature("video/mp4", ftyp("mp42")), true);
  assert.equal(matchesMediaSignature("video/quicktime", ftyp("qt  ")), true);
  assert.equal(matchesMediaSignature("image/png", png), true);
  assert.equal(
    matchesMediaSignature("image/jpeg", Buffer.from([255, 216, 255, 224])),
    true,
  );
  assert.equal(
    matchesMediaSignature("image/webp", Buffer.from("RIFF....WEBPVP8 ")),
    true,
  );
  assert.equal(
    matchesMediaSignature("image/png", Buffer.from("<svg>fake file</svg>")),
    false,
  );
});

test("R2 assina envio imutável por objeto e confere cabeçalhos e bytes antes de confirmar", async (t) => {
  const id = crypto.randomUUID();
  const ticket = await mediaUploadUrl(config, id, item, 600);
  const url = new URL(ticket.url);
  assert.equal(url.origin, `https://${account}.r2.cloudflarestorage.com`);
  assert.equal(url.pathname, `/vip-test/vip/${id}`);
  assert.equal(ticket.headers["If-None-Match"], "*");
  assert.match(
    ticket.headers["Content-Disposition"],
    /^attachment; filename\*=UTF-8''/,
  );
  assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
  assert.deepEqual(url.searchParams.get("X-Amz-SignedHeaders").split(";"), [
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
    "host",
    "if-none-match",
  ]);
  assert.notEqual(
    new URL(
      (
        await mediaUploadUrl(
          config,
          id,
          { ...item, sizeBytes: png.length + 1 },
          600,
        )
      ).url,
    ).searchParams.get("X-Amz-Signature"),
    url.searchParams.get("X-Amz-Signature"),
  );
  assert.equal(
    new URL(await mediaDownloadUrl(config, id)).searchParams.get(
      "X-Amz-Expires",
    ),
    "60",
  );
  let headers = {
    "Content-Range": `bytes 0-${png.length - 1}/${png.length}`,
    "Content-Length": String(png.length),
    "Content-Type": item.contentType,
    "Content-Disposition": ticket.headers["Content-Disposition"],
    "Cache-Control": "private, no-store",
  };
  t.mock.method(globalThis, "fetch", async (request) => {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("range"), `bytes=0-${png.length - 1}`);
    return new Response(png, { status: 206, headers });
  });
  assert.equal(await verifyMediaObject(config, id, item), "valid");
  headers = { ...headers, "Content-Encoding": "gzip" };
  assert.equal(await verifyMediaObject(config, id, item), "invalid");
});

test("PostgreSQL 17: convite revogável, arquivos só confirmados, cotas e isolamento do worker", async () => {
  const { db, actor, worker, admin, client, other, command } =
    await pomarFixture();
  const project = crypto.randomUUID(),
    second = crypto.randomUUID();
  const hash = "d".repeat(64),
    otherHash = "e".repeat(64),
    rotated = "f".repeat(64);
  const upload = crypto.randomUUID();
  const rpc = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0].value;
  const ownerView = (id = project) =>
    rpc("select pomar_media_project($1) value", [id]);
  const issue = (id, value) =>
    rpc("select pomar_media_set_link($1,$2) value", [id, value]);
  const status = (value) =>
    rpc("select pomar_private.media_link_status($1) value", [value]);
  const reserve = (
    token,
    id = upload,
    name = "ficticio.png",
    type = "image/png",
    size = 1234,
  ) =>
    rpc("select pomar_private.media_reserve($1,$2,$3,$4,$5) value", [
      token,
      id,
      name,
      type,
      size,
    ]);
  try {
    await actor();
    const area = {
      ...newBase(),
      name: "Área fictícia",
      color: "green",
      archived: false,
    };
    await command({ type: "saveArea", value: area });
    for (const id of [project, second])
      await command({
        type: "saveProject",
        value: {
          ...newBase(),
          id,
          name: "Projeto fictício",
          clientId: client,
          contractorId: null,
          areaId: area.id,
          status: "active",
          priority: "P2",
          startedOn: null,
          dueOn: null,
          nextAction: "",
          nextActionOn: null,
          waitingFor: "",
          notes: "",
        },
      });
    assert.ok((await issue(project, hash)).expires_at);
    await issue(second, otherHash);
    await assert.rejects(db.query("select * from pomar_private.media_links"), {
      code: "42501",
    });
    await assert.rejects(reserve(hash), { code: "42501" });

    await worker("pomar_media_worker");
    assert.deepEqual(Object.keys(await status(hash)), ["expires_at"]);
    assert.equal(await status("0".repeat(64)), null);
    await assert.rejects(ownerView(), { code: "42501" });
    await assert.rejects(
      db.query("select * from pomar_private.media_uploads"),
      { code: "42501" },
    );
    await assert.rejects(db.query("select pomar_workspace()"), {
      code: "42501",
    });
    assert.equal((await reserve(hash)).received, false);
    assert.equal((await reserve(hash)).received, false);
    await assert.rejects(reserve(otherHash), /POMAR_KEY_REUSED/);
    assert.equal(
      await rpc("select pomar_private.media_check($1,$2) value", [
        otherHash,
        upload,
      ]),
      null,
    );
    assert.equal(
      await rpc("select pomar_private.media_confirm($1,$2) value", [
        hash,
        upload,
      ]),
      false,
    );
    assert.equal(
      (
        await rpc("select pomar_private.media_check($1,$2) value", [
          hash,
          upload,
        ])
      ).size_bytes,
      1234,
    );
    assert.equal(
      await rpc("select pomar_private.media_confirm($1,$2) value", [
        hash,
        upload,
      ]),
      true,
    );
    assert.equal((await reserve(hash)).received, true);
    for (let i = 0; i < 3; i++)
      await reserve(
        hash,
        crypto.randomUUID(),
        "video.mp4",
        "video/mp4",
        500000000,
      );
    await assert.rejects(
      reserve(hash, crypto.randomUUID(), "video.mp4", "video/mp4", 500000000),
      /POMAR_MEDIA_QUOTA/,
    );
    await actor();
    assert.equal((await ownerView()).files[0].file_name, "ficticio.png");
    assert.equal((await ownerView()).pending_count, 3);
    assert.equal((await ownerView(second)).files.length, 0);
    await issue(project, rotated);
    await admin();
    await db.query(
      "update pomar_private.media_links set expires_at=now()-interval '1 minute' where token_hash=$1",
      [otherHash],
    );
    await worker("pomar_media_worker");
    assert.equal(await status(hash), null);
    assert.equal(await status(otherHash), null);
    assert.ok(await status(rotated));
    await actor();
    await db.query("update pomar_projects set status='cancelled' where id=$1", [
      project,
    ]);
    await db.query("update pomar_projects set status='active' where id=$1", [
      project,
    ]);
    await worker("pomar_media_worker");
    assert.equal(await status(rotated), null);
    await actor();
    await issue(project, "a".repeat(64));
    assert.equal((await issue(project, null)).expires_at, null);
    await actor(other);
    await assert.rejects(ownerView(), /POMAR_ACCESS/);
    await admin();
    await db.exec("set session authorization anon");
    await assert.rejects(ownerView(), { code: "42501" });
  } finally {
    await db.close();
  }
});
