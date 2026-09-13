const SECTOR_COUNT = 255;
const SECTOR_SIZE = 686;
const HEADER_PREAMBLE_SIZE = 12;
const HEADER_SIZE = 16;
const DATA_PREAMBLE_SIZE = 12;
const RECORD_SIZE = 612;
const IMAGE_SIZE = SECTOR_COUNT * SECTOR_SIZE;

/**
 * Immutable, read-only view of a QLAY-compatible Microdrive image.
 *
 * Each of the 255 sectors contains a 12-byte header preamble, a 16-byte
 * sector header, a 12-byte data preamble, a 612-byte QDOS record and 34
 * trailing bytes. The ZX8302 exposes the header and record, not the preambles.
 */
export class MicrodriveImage {
  #bytes;

  constructor(bytes, { name = "cartucho.mdv" } = {}) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("A imagem de Microdrive deve ser fornecida como Uint8Array.");
    }
    if (bytes.byteLength !== IMAGE_SIZE) {
      throw new RangeError(`Uma imagem .mdv deve ter exatamente ${IMAGE_SIZE} bytes.`);
    }

    this.#bytes = bytes.slice();
    this.name = String(name);
  }

  readHeaderByte(sector, offset) {
    this.validatePosition(sector, offset, HEADER_SIZE, "cabeçalho");
    return this.#bytes[sector * SECTOR_SIZE + HEADER_PREAMBLE_SIZE + offset];
  }

  readRecordByte(sector, offset) {
    this.validatePosition(sector, offset, RECORD_SIZE, "registo");
    const recordStart = HEADER_PREAMBLE_SIZE + HEADER_SIZE + DATA_PREAMBLE_SIZE;
    return this.#bytes[sector * SECTOR_SIZE + recordStart + offset];
  }

  validatePosition(sector, offset, length, region) {
    if (!Number.isInteger(sector) || sector < 0 || sector >= SECTOR_COUNT) {
      throw new RangeError("O setor de Microdrive deve estar entre 0 e 254.");
    }
    if (!Number.isInteger(offset) || offset < 0 || offset >= length) {
      throw new RangeError(`A posição no ${region} está fora dos limites.`);
    }
  }
}

export const MICRODRIVE_FORMAT = Object.freeze({
  sectorCount: SECTOR_COUNT,
  sectorSize: SECTOR_SIZE,
  headerPreambleSize: HEADER_PREAMBLE_SIZE,
  headerSize: HEADER_SIZE,
  dataPreambleSize: DATA_PREAMBLE_SIZE,
  recordSize: RECORD_SIZE,
  imageSize: IMAGE_SIZE,
});
