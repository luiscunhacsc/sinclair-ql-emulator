import assert from "node:assert/strict";
import test from "node:test";
import { QLBus } from "../src/core/bus.js";
import { MICRODRIVE_FORMAT } from "../src/devices/microdrive.js";
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

function selectMicrodrive(bus, slot = 1) {
  bus.write8(ZX8302_REGISTERS.microdriveControl, 0x03);
  bus.write8(ZX8302_REGISTERS.microdriveControl, 0x01);
  for (let drive = 1; drive < slot; drive += 1) {
    bus.write8(ZX8302_REGISTERS.microdriveControl, 0x02);
    bus.write8(ZX8302_REGISTERS.microdriveControl, 0x00);
  }
}

function finishGap(bus) {
  assert.equal(
    bus.read8(ZX8302_REGISTERS.microdriveControl) & ZX8302_REGISTERS.microdriveGap,
    ZX8302_REGISTERS.microdriveGap,
  );
  for (let poll = 0; poll < ZX8302_REGISTERS.microdriveGapPolls; poll += 1) {
    assert.equal(bus.read8(ZX8302_REGISTERS.microdriveControl) & 0x0c, 0);
  }
  assert.equal(
    bus.read8(ZX8302_REGISTERS.microdriveControl) & ZX8302_REGISTERS.microdriveReadReady,
    ZX8302_REGISTERS.microdriveReadReady,
  );
}

function readReadyBytes(bus, length, address = ZX8302_REGISTERS.microdriveTrack1) {
  const bytes = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      assert.equal(
        bus.read8(ZX8302_REGISTERS.microdriveControl)
          & ZX8302_REGISTERS.microdriveReadReady,
        ZX8302_REGISTERS.microdriveReadReady,
      );
    }
    bytes.push(bus.read8(address));
  }
  return bytes;
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

test("monta e ejeta imagens .mdv sem as remover durante RESET", () => {
  const zx8302 = new ZX8302();
  const bytes = new Uint8Array(MICRODRIVE_FORMAT.imageSize);

  const image = zx8302.mountMicrodrive(1, bytes, { name: "programas.mdv" });
  assert.equal(zx8302.microdriveAt(1), image);
  assert.equal(image.name, "programas.mdv");
  assert.throws(() => zx8302.mountMicrodrive(0, bytes), RangeError);

  zx8302.reset();
  assert.equal(zx8302.microdriveAt(1), image);
  assert.equal(zx8302.activeMicrodrive, 0);
  assert.equal(zx8302.unmountMicrodrive(1), image);
  assert.equal(zx8302.microdriveAt(1), null);
});

test("seleciona Microdrives pela cadeia de controlo do ZX8302", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });

  selectMicrodrive(bus, 2);
  assert.equal(zx8302.activeMicrodrive, 2);

  for (let pulse = 2; pulse <= 8; pulse += 1) {
    bus.write8(ZX8302_REGISTERS.microdriveControl, 0x02);
    bus.write8(ZX8302_REGISTERS.microdriveControl, 0x00);
  }
  assert.equal(zx8302.activeMicrodrive, 0);
});

test("não anuncia um GAP fantasma no modo Microdrive sem motor ativo", () => {
  const zx8302 = new ZX8302();
  const bus = new QLBus({ devices: [zx8302] });
  bus.write8(ZX8302_REGISTERS.transmitControl, ZX8302_REGISTERS.microdriveMode);
  assert.equal(bus.read8(ZX8302_REGISTERS.microdriveControl), 0);
});

test("lê cabeçalho e dados de um setor .mdv no modo Microdrive", () => {
  const bytes = new Uint8Array(MICRODRIVE_FORMAT.imageSize);
  const headerStart = MICRODRIVE_FORMAT.headerPreambleSize;
  const recordStart = headerStart
    + MICRODRIVE_FORMAT.headerSize
    + MICRODRIVE_FORMAT.dataPreambleSize;
  for (let index = 0; index < MICRODRIVE_FORMAT.headerSize; index += 1) {
    bytes[headerStart + index] = 0x20 + index;
  }
  for (let index = 0; index < MICRODRIVE_FORMAT.recordSize; index += 1) {
    bytes[recordStart + index] = index & 0xff;
  }

  const zx8302 = new ZX8302();
  zx8302.mountMicrodrive(1, bytes);
  const bus = new QLBus({ devices: [zx8302] });
  bus.write8(ZX8302_REGISTERS.transmitControl, ZX8302_REGISTERS.microdriveMode);
  selectMicrodrive(bus);

  finishGap(bus);
  const header = readReadyBytes(bus, MICRODRIVE_FORMAT.headerSize);
  assert.deepEqual(header, Array.from({ length: 16 }, (_, index) => 0x20 + index));

  finishGap(bus);
  const blockHeader = readReadyBytes(bus, 4);
  assert.deepEqual(blockHeader, [0, 1, 2, 3]);

  bus.write8(ZX8302_REGISTERS.microdriveControl, 0x02);
  bus.write8(ZX8302_REGISTERS.microdriveControl, 0x02);
  assert.equal(bus.read8(ZX8302_REGISTERS.microdriveTrack2), 12);

  for (let poll = 4; poll < MICRODRIVE_FORMAT.recordSize; poll += 1) {
    bus.read8(ZX8302_REGISTERS.microdriveControl);
  }
  assert.equal(zx8302.microdriveSector, 0, "o setor só avança quando começa o GAP seguinte");
  assert.equal(
    bus.read8(ZX8302_REGISTERS.microdriveControl) & ZX8302_REGISTERS.microdriveGap,
    ZX8302_REGISTERS.microdriveGap,
  );
  assert.equal(zx8302.microdriveSector, 1);
});

test("gera interrupções de gap periódicas enquanto um motor está ativo", () => {
  const zx8302 = new ZX8302();
  zx8302.mountMicrodrive(1, new Uint8Array(MICRODRIVE_FORMAT.imageSize));
  const bus = new QLBus({ devices: [zx8302] });
  selectMicrodrive(bus);
  bus.write8(ZX8302_REGISTERS.interrupt, ZX8302_REGISTERS.gapInterruptMask);

  bus.tick(ZX8302_REGISTERS.microdriveGapCycles - 1);
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), 0);
  bus.tick(1);
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), ZX8302_REGISTERS.gapInterrupt);

  bus.write8(
    ZX8302_REGISTERS.interrupt,
    ZX8302_REGISTERS.gapInterruptMask | ZX8302_REGISTERS.gapInterrupt,
  );
  assert.equal(bus.read8(ZX8302_REGISTERS.interrupt), 0);
});
