import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QLBus } from "../src/core/bus.js";
import { MC68008 } from "../src/core/mc68008.js";
import { MICRODRIVE_FORMAT } from "../src/devices/microdrive.js";
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

test("a Minerva recebe e reconhece a interrupção periódica de frame", async () => {
  const zx8301 = new ZX8301();
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8301, zx8302] });
  const rom = await readFile(new URL("../roms/minerva/minerva-1.98a1.bin", import.meta.url));
  bus.loadRom(new Uint8Array(rom));
  const cpu = new MC68008(bus);
  cpu.reset();

  const instructionLimit = 1_000_000;
  let instructions = 0;
  while (instructions < instructionLimit && cpu.lastException?.vector !== 26) {
    const cycles = cpu.step();
    bus.tick(cycles);
    cpu.setInterruptLevel(bus.interruptLevel);
    instructions += 1;
  }

  assert.ok(instructions < instructionLimit, "a ROM não recebeu a interrupção de nível 2");
  assert.equal(cpu.lastException?.vector, 26);

  while (instructions < instructionLimit && bus.interruptLevel !== 0) {
    const cycles = cpu.step();
    bus.tick(cycles);
    cpu.setInterruptLevel(bus.interruptLevel);
    instructions += 1;
  }
  assert.equal(bus.interruptLevel, 0, "a ROM não reconheceu a interrupção de frame");
});

test("a Minerva recebe F1 e texto pelo IPC até ao SuperBASIC interativo", async () => {
  const zx8301 = new ZX8301();
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8301, zx8302] });
  const rom = await readFile(new URL("../roms/minerva/minerva-1.98a1.bin", import.meta.url));
  bus.loadRom(new Uint8Array(rom));
  const cpu = new MC68008(bus);
  cpu.reset();

  zx8302.enqueueKey(57); // F1: monitor, MODE 4.
  for (let instruction = 0; instruction < 2_000_000; instruction += 1) {
    const cycles = cpu.step();
    bus.tick(cycles);
    cpu.setInterruptLevel(bus.interruptLevel);
  }

  // "print 42" + ENTER, expressed as positions in the physical QL matrix.
  for (const keyrow of [29, 20, 18, 6, 14, 54, 62, 9, 48]) zx8302.enqueueKey(keyrow);
  for (let instruction = 0; instruction < 1_000_000; instruction += 1) {
    const cycles = cpu.step();
    bus.tick(cycles);
    cpu.setInterruptLevel(bus.interruptLevel);
  }

  const frame = zx8301.renderFrame(bus);
  let greenPixelsInCommandWindow = 0;
  for (let y = 202; y < 256; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      const offset = (y * 512 + x) * 4;
      if (frame[offset] === 0 && frame[offset + 1] === 255 && frame[offset + 2] === 0) {
        greenPixelsInCommandWindow += 1;
      }
    }
  }

  assert.equal(zx8301.mode, 4);
  assert.equal(zx8302.keyboardQueue.length, 0);
  assert.ok(greenPixelsInCommandWindow > 20, "o comando não apareceu na janela #0");
});

test("a Minerva seleciona MDV1 e inicia a leitura de uma imagem montada", async () => {
  const zx8302 = new ZX8302();
  zx8302.mountMicrodrive(1, new Uint8Array(MICRODRIVE_FORMAT.imageSize));
  const bus = new QLBus({ devices: [new ZX8301(), zx8302] });
  const rom = await readFile(new URL("../roms/minerva/minerva-1.98a1.bin", import.meta.url));
  bus.loadRom(new Uint8Array(rom));
  const cpu = new MC68008(bus);
  cpu.reset();
  zx8302.enqueueKey(57); // F1: inicia o QL e a pesquisa de mdv1_boot.

  const instructionLimit = 2_000_000;
  let instructions = 0;
  while (instructions < instructionLimit && zx8302.microdriveDataReads === 0) {
    const cycles = cpu.step();
    bus.tick(cycles);
    cpu.setInterruptLevel(bus.interruptLevel);
    instructions += 1;
  }

  assert.ok(instructions < instructionLimit, "a Minerva não começou a ler MDV1");
  assert.equal(zx8302.activeMicrodrive, 1);
  assert.ok(zx8302.microdriveDataReads > 0);
});
