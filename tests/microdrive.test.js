import assert from "node:assert/strict";
import test from "node:test";
import { MicrodriveImage, MICRODRIVE_FORMAT } from "../src/devices/microdrive.js";

test("valida o tamanho canónico das imagens QLAY .mdv", () => {
  assert.equal(MICRODRIVE_FORMAT.sectorCount, 255);
  assert.equal(MICRODRIVE_FORMAT.sectorSize, 686);
  assert.equal(MICRODRIVE_FORMAT.imageSize, 174_930);

  assert.throws(() => new MicrodriveImage(new Uint8Array(1)), RangeError);
  assert.throws(() => new MicrodriveImage(new ArrayBuffer(MICRODRIVE_FORMAT.imageSize)), TypeError);
});

test("expõe cabeçalhos e registos sem os preâmbulos físicos", () => {
  const bytes = new Uint8Array(MICRODRIVE_FORMAT.imageSize);
  const sector = 7;
  const sectorStart = sector * MICRODRIVE_FORMAT.sectorSize;
  const recordStart = MICRODRIVE_FORMAT.headerPreambleSize
    + MICRODRIVE_FORMAT.headerSize
    + MICRODRIVE_FORMAT.dataPreambleSize;

  bytes[sectorStart + MICRODRIVE_FORMAT.headerPreambleSize] = 0x47;
  bytes[sectorStart + recordStart] = 0x91;
  const image = new MicrodriveImage(bytes, { name: "teste.mdv" });

  assert.equal(image.name, "teste.mdv");
  assert.equal(image.readHeaderByte(sector, 0), 0x47);
  assert.equal(image.readRecordByte(sector, 0), 0x91);
  assert.throws(() => image.readHeaderByte(255, 0), RangeError);
  assert.throws(() => image.readRecordByte(0, MICRODRIVE_FORMAT.recordSize), RangeError);

  bytes[sectorStart + MICRODRIVE_FORMAT.headerPreambleSize] = 0;
  assert.equal(image.readHeaderByte(sector, 0), 0x47, "a imagem montada deve ser uma cópia");
});
