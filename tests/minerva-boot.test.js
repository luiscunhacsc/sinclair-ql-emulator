import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QLBus } from "../src/core/bus.js";
import { MC68008 } from "../src/core/mc68008.js";
import { ZX8301 } from "../src/devices/zx8301.js";
import { ZX8302 } from "../src/devices/zx8302.js";

test("a Minerva alcança MC_STAT e ativa MODE 4", async () => {
  const zx8301 = new ZX8301();
  const bus = new QLBus({ devices: [zx8301] });
  const rom = await readFile(new URL("../roms/minerva/minerva-1.98a1.bin", import.meta.url));
  bus.loadRom(new Uint8Array(rom));
  const cpu = new MC68008(bus);
  cpu.reset();

  const instructionLimit = 100_000;
  let instructions = 0;
  while (instructions < instructionLimit && zx8301.displayControlWrites === 0) {
    cpu.step();
    instructions += 1;
  }

  assert.ok(instructions < instructionLimit, "a ROM não alcançou MC_STAT dentro do limite");
  assert.equal(zx8301.displayControlWrites, 1);
  assert.equal(zx8301.displayControl, 0);
  assert.equal(zx8301.mode, 4);
  assert.equal(zx8301.blanked, false);
  assert.equal(cpu.lastException, null);
});

test("a Minerva conclui o handshake IPC inicial e desenha na display RAM", async () => {
  const zx8301 = new ZX8301();
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8301, zx8302] });
  const rom = await readFile(new URL("../roms/minerva/minerva-1.98a1.bin", import.meta.url));
  bus.loadRom(new Uint8Array(rom));
  const cpu = new MC68008(bus);
  cpu.reset();

  const instructionLimit = 1_000_000;
  let instructions = 0;
  while (instructions < instructionLimit && zx8302.ipcWrites < 9) {
    cpu.step();
    instructions += 1;
  }

  const frame = zx8301.renderFrame(bus);
  let colouredPixels = 0;
  for (let offset = 0; offset < frame.length; offset += 4) {
    if (frame[offset] || frame[offset + 1] || frame[offset + 2]) colouredPixels += 1;
  }

  assert.ok(instructions < instructionLimit, "a ROM não concluiu o comando IPC de arranque");
  assert.ok(colouredPixels > 0, "a ROM não produziu qualquer píxel visível");
  assert.equal(cpu.lastException?.vector, 33, "esperava-se a atividade normal de TRAP #1");
});
