import assert from "node:assert/strict";
import test from "node:test";
import { QLBus } from "../src/core/bus.js";
import { ZX8302, ZX8302_REGISTERS } from "../src/devices/zx8302.js";

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
