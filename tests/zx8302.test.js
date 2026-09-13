import assert from "node:assert/strict";
import test from "node:test";
import { QLBus } from "../src/core/bus.js";
import { ZX8302, ZX8302_REGISTERS } from "../src/devices/zx8302.js";

function transferBit(bus, bit) {
  bus.write8(ZX8302_REGISTERS.ipcWrite, 0x0c | ((bit & 1) << 1));
  return bus.read8(ZX8302_REGISTERS.ipcRead) >>> 7;
}

function transferValue(bus, value, width) {
  for (let bit = width - 1; bit >= 0; bit -= 1) transferBit(bus, value >>> bit);
}

function readValue(bus, width) {
  let value = 0;
  for (let bit = 0; bit < width; bit += 1) value = (value << 1) | transferBit(bus, 1);
  return value;
}

function command(bus, value) {
  transferValue(bus, value, 4);
}

test("o handshake IPC inativo confirma imediatamente cada bit", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });

  bus.write8(ZX8302_REGISTERS.ipcWrite, 0x0e);
  assert.equal(bus.read8(ZX8302_REGISTERS.ipcRead), ZX8302_REGISTERS.idleIpcStatus);
  assert.equal(bus.read8(ZX8302_REGISTERS.ipcRead) & 0x40, 0);
  assert.equal(zx8302.ipcWrite, 0x0e);
  assert.equal(zx8302.ipcWrites, 1);
});

test("o bloco conserva controlo de transmissão e máscara de interrupções", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });

  bus.write8(ZX8302_REGISTERS.transmitControl, 0xa5);
  bus.write8(ZX8302_REGISTERS.interrupt, 0xff);
  assert.equal(zx8302.transmitControl, 0xa5);
  assert.equal(zx8302.interruptMask, 0xe0);

  bus.resetDevices();
  assert.equal(zx8302.transmitControl, 0);
  assert.equal(zx8302.interruptMask, 0);
  assert.equal(zx8302.ipcWrites, 0);
});

test("gera e reconhece a interrupção de frame de 50 Hz", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });

  bus.tick(ZX8302_REGISTERS.frameCycles - 1);
  assert.equal(bus.interruptLevel, 0);
  bus.tick(1);
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), ZX8302_REGISTERS.frameInterrupt);
  assert.equal(bus.interruptLevel, 2);

  bus.write8(ZX8302_REGISTERS.interrupt, ZX8302_REGISTERS.frameInterrupt);
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), 0);
  assert.equal(bus.interruptLevel, 0);
});

test("conserva a fase de frame e valida o avanço temporal", () => {
  const zx8302 = new ZX8302();
  zx8302.tick(ZX8302_REGISTERS.frameCycles * 2 + 17);
  assert.equal(zx8302.frameCycleAccumulator, 17);
  assert.throws(() => zx8302.tick(-1), RangeError);
});

test("a ausência de cartucho solicita serviço quando a interrupção de gap é ativada", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });

  bus.write8(ZX8302_REGISTERS.interrupt, ZX8302_REGISTERS.gapInterruptMask);
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), ZX8302_REGISTERS.gapInterrupt);
  assert.equal(bus.interruptLevel, 2);

  bus.write8(
    ZX8302_REGISTERS.interrupt,
    ZX8302_REGISTERS.gapInterruptMask | ZX8302_REGISTERS.gapInterrupt,
  );
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), ZX8302_REGISTERS.gapInterrupt);

  bus.write8(ZX8302_REGISTERS.interrupt, ZX8302_REGISTERS.gapInterrupt);
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), 0);
  assert.equal(bus.interruptLevel, 0);
});

test("o IPC reporta e entrega teclas no formato esperado pela Minerva", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });

  command(bus, 1);
  assert.equal(readValue(bus, 8), 0);

  zx8302.enqueueKey(57, { shift: true, alt: true });
  command(bus, 1);
  assert.equal(readValue(bus, 8), 1);

  command(bus, 8);
  assert.equal(readValue(bus, 4), 1);
  assert.equal(readValue(bus, 4), 0x05);
  assert.equal(readValue(bus, 8), 57);

  command(bus, 1);
  assert.equal(readValue(bus, 8), 0);
});

test("comandos IPC com parâmetros conservam o alinhamento do fluxo de bits", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });

  bus.write8(ZX8302_REGISTERS.ipcWrite, 0x01);
  command(bus, 13);
  transferValue(bus, 1, 4);
  command(bus, 15);
  transferValue(bus, 0xa5, 8);
  assert.equal(readValue(bus, 8), 0xa5);

  command(bus, 1);
  assert.equal(readValue(bus, 8), 0);
});

test("a fila do teclado valida keyrows e é limpa pelo RESET", () => {
  const zx8302 = new ZX8302();
  assert.throws(() => zx8302.enqueueKey(-1), RangeError);
  assert.throws(() => zx8302.enqueueKey(64), RangeError);

  zx8302.enqueueKey(48);
  assert.equal(zx8302.keyboardQueue.length, 1);
  zx8302.reset();
  assert.equal(zx8302.keyboardQueue.length, 0);
});
