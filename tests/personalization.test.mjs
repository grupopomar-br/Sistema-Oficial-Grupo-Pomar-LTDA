import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { emptyWorkspace, newBase } from "../src/lib/domain/model.ts";
import { applyCommand, parseWorkspace } from "../src/lib/domain/workspace.ts";
import { importBackup, exportBackup } from "../src/lib/domain/backup.ts";
import {
  hasRecentMfa,
  sessionPolicy,
  touchOwnerSession,
  LEGACY_SESSION_POLICY,
} from "../src/lib/domain/security.ts";
import {
  normalizeProfileImage,
  profileBytes,
  PROFILE_MAX_BYTES,
} from "../src/lib/profile/image.ts";
const command = (state, command) =>
  applyCommand(state, { commandId: crypto.randomUUID(), command });
const method = () => ({
  ...newBase(),
  title: "Método de exemplo",
  service: "Serviço fictício",
  purpose: "Objetivo",
  steps: "Diagnóstico\nExecução\nConferência",
  differentiators: "Acompanhamento",
  deliverables: "Relatório",
  qualityCriteria: "Revisão",
  notes: "Referências",
  archived: false,
});

test("metodologias e perfil persistem no backup; alterações concorrentes são rejeitadas e arquivo pode ser restaurado", () => {
  let state = emptyWorkspace();
  state = command(state, { type: "saveMethodology", value: method() });
  const original = state.methodologies[0];
  state = command(state, {
    type: "saveMethodology",
    value: { ...original, archived: true },
  });
  assert.equal(state.methodologies[0].version, 2);
  assert.throws(
    () => command(state, { type: "saveMethodology", value: original }),
    /alterado/,
  );
  state = command(state, {
    type: "saveMethodology",
    value: { ...state.methodologies[0], archived: false },
  });
  state = command(state, {
    type: "saveProfile",
    avatarPath: "brand",
    expectedVersion: 0,
  });
  assert.throws(
    () =>
      command(state, {
        type: "saveProfile",
        avatarPath: "",
        expectedVersion: 0,
      }),
    /outra sessão/,
  );
  assert.deepEqual(importBackup(exportBackup(state)), state);
  assert.equal(state.methodologies[0].archived, false);
  assert.throws(() =>
    command(state, {
      type: "saveProfile",
      avatarPath: "https://example.com/spy.svg",
      expectedVersion: 1,
    }),
  );
  const legacy = structuredClone(state);
  delete legacy.profile;
  delete legacy.methodologies;
  delete legacy.personalizationReady;
  const restored = parseWorkspace(legacy);
  assert.deepEqual(restored.profile, { avatarPath: "", version: 0 });
  assert.deepEqual(restored.methodologies, []);
});

test("avatar é decodificado, reduzido e regravado como WebP sem metadados; SVG e lixo são rejeitados", async () => {
  const input = await sharp({
    create: { width: 1100, height: 700, channels: 4, background: "#dff377" },
  })
    .withMetadata()
    .png()
    .toBuffer();
  const output = await normalizeProfileImage(input);
  const meta = await sharp(output).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.exif, undefined);
  for (const bad of [
    Buffer.from(
      "<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>",
    ),
    Buffer.from("not an image"),
    Buffer.alloc(0),
    Buffer.alloc(PROFILE_MAX_BYTES + 1),
  ])
    await assert.rejects(normalizeProfileImage(bad));
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(PROFILE_MAX_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(profileBytes(stream), /2 MB/);
  assert.equal(cancelled, true);
});

test("avatar 1:1 preserva os quatro cantos de fotos quadradas, verticais, horizontais e pequenas", async () => {
  const colors = [
    [230, 40, 40],
    [40, 200, 40],
    [40, 40, 230],
    [230, 210, 40],
  ];
  for (const [width, height] of [
    [128, 128],
    [1024, 512],
    [512, 1024],
    [64, 32],
  ]) {
    const pixels = Buffer.alloc(width * height * 4, 255);
    const markerWidth = Math.max(4, Math.floor(width / 8));
    const markerHeight = Math.max(4, Math.floor(height / 8));
    const corners = [
      [0, 0],
      [width - markerWidth, 0],
      [0, height - markerHeight],
      [width - markerWidth, height - markerHeight],
    ];
    for (const [index, [left, top]] of corners.entries()) {
      for (let y = top; y < top + markerHeight; y++)
        for (let x = left; x < left + markerWidth; x++)
          for (let channel = 0; channel < 3; channel++)
            pixels[(y * width + x) * 4 + channel] = colors[index][channel];
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const output = await normalizeProfileImage(input);
    const { data, info } = await sharp(output)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 512);
    assert.equal(info.height, 512);
    const scale = Math.min(512 / width, 512 / height);
    const offsetX = (512 - width * scale) / 2;
    const offsetY = (512 - height * scale) / 2;
    for (const [index, [left, top]] of corners.entries()) {
      const x = Math.floor(offsetX + (left + markerWidth / 2) * scale);
      const y = Math.floor(offsetY + (top + markerHeight / 2) * scale);
      const pixel = (y * info.width + x) * info.channels;
      assert.equal(data[pixel + 3], 255);
      for (let channel = 0; channel < 3; channel++)
        assert.ok(
          Math.abs(data[pixel + channel] - colors[index][channel]) < 35,
          `canto ${index} preservado em ${width}x${height}`,
        );
    }
    assert.equal(
      data[3],
      width === height ? 255 : 0,
      "as margens de imagens retangulares ficam transparentes",
    );
  }
});

test("política de sessão depende da migração: fallback apenas para RPC ausente, sem ocultar erros", async () => {
  const calls = [];
  const legacy = await touchOwnerSession(async (name) => {
    calls.push(name);
    return name.endsWith("v2")
      ? { data: null, error: { code: "PGRST202" } }
      : { data: "granted", error: null };
  });
  assert.deepEqual(calls, ["pomar_touch_session_v2", "pomar_touch_session"]);
  assert.deepEqual(legacy.policy, LEGACY_SESSION_POLICY);
  const policy = { idleTimeoutMs: 3600000, sensitiveMfaSeconds: 1800 };
  const current = await touchOwnerSession(async () => ({
    data: { status: "granted", policy },
    error: null,
  }));
  assert.deepEqual(current.policy, policy);
  assert.equal(
    sessionPolicy({ idleTimeoutMs: 999999999, sensitiveMfaSeconds: 99999999 }),
    null,
  );
  let count = 0;
  const failed = await touchOwnerSession(async () => {
    count++;
    return { data: null, error: { code: "42501" } };
  });
  assert.equal(count, 1);
  assert.equal(failed.error.code, "42501");
  assert.equal(failed.policy, null);
  const now = Date.now(),
    timestamp = Math.floor(now / 1000);
  assert.equal(
    hasRecentMfa(
      { aal: "aal2", amr: [{ method: "totp", timestamp: timestamp - 1200 }] },
      now,
      1800,
    ),
    true,
  );
  assert.equal(
    hasRecentMfa(
      { aal: "aal2", amr: [{ method: "totp", timestamp: timestamp - 1801 }] },
      now,
      1800,
    ),
    false,
  );
  assert.equal(
    hasRecentMfa(
      { aal: "aal1", amr: [{ method: "totp", timestamp }] },
      now,
      1800,
    ),
    false,
  );
});
