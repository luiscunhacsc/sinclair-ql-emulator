import { buildMicrodriveImage } from "./microdrive-builder.js";
import { readZipArchive } from "./zip.js";

const QDOS_EXTRA_FIELD = 0xfb4a;
const QDOS_INLINE_MAGIC = new TextEncoder().encode("]!QDOS File Header");

function readBe32(bytes, offset) {
  return (
    (bytes[offset] * 0x1_000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function startsWith(bytes, prefix) {
  return bytes.byteLength >= prefix.byteLength && prefix.every((byte, index) => bytes[index] === byte);
}

function parseQdosExtra(extra) {
  for (let offset = 0; offset + 4 <= extra.byteLength;) {
    const id = extra[offset] | (extra[offset + 1] << 8);
    const size = extra[offset + 2] | (extra[offset + 3] << 8);
    const start = offset + 4;
    if (start + size > extra.byteLength) break;
    if (
      id === QDOS_EXTRA_FIELD
      && size >= 72
      && new TextDecoder().decode(extra.subarray(start, start + 8)) === "QZHDQDOS"
    ) {
      const header = extra.subarray(start + 8, start + 72);
      return {
        access: header[4],
        type: header[5],
        dataSpace: readBe32(header, 6),
        extraInfo: readBe32(header, 10),
        updateDate: readBe32(header, 52),
        referenceDate: readBe32(header, 56),
        backupDate: readBe32(header, 60),
      };
    }
    offset = start + size;
  }
  return {};
}

function removeInlineHeader(bytes) {
  if (!startsWith(bytes, QDOS_INLINE_MAGIC) || bytes.byteLength < 20) return { bytes, metadata: {} };
  const headerSize = bytes[19] * 2;
  if (bytes[18] !== 0 || headerSize < 30 || headerSize > bytes.byteLength) {
    throw new Error("Foi encontrado um cabeçalho QDOS inline inválido.");
  }
  return {
    bytes: bytes.slice(headerSize),
    metadata: {
      access: bytes[20],
      type: bytes[21],
      dataSpace: readBe32(bytes, 22),
      extraInfo: readBe32(bytes, 26),
    },
  };
}

function parseConfig(entries) {
  const configEntry = entries.find((entry) => entry.name.toLocaleLowerCase("en").endsWith(".qcf"));
  if (!configEntry) return {};
  const text = new TextDecoder().decode(configEntry.bytes);
  return Object.fromEntries(text.split(/\r?\n/u).flatMap((line) => {
    const separator = line.indexOf("=");
    return separator < 0 ? [] : [[line.slice(0, separator).trim().toLocaleLowerCase("en"), line.slice(separator + 1).trim()]];
  }));
}

function qlName(path) {
  return path.replaceAll("/", "_").replaceAll(".", "_").slice(0, 36);
}

function rewriteBootDevice(bytes, sourceDevice, microdrive) {
  if (sourceDevice.length !== 3 || (sourceDevice === "mdv" && microdrive === 1)) {
    return { bytes, replacements: 0 };
  }
  const from = new TextEncoder().encode(`${sourceDevice}1_`);
  const to = new TextEncoder().encode(`mdv${microdrive}_`);
  const rewritten = bytes.slice();
  let replacements = 0;
  for (let offset = 0; offset + from.byteLength <= bytes.byteLength; offset += 1) {
    const matches = from.every((expected, index) => {
      const actual = bytes[offset + index];
      return (actual >= 0x41 && actual <= 0x5a ? actual + 0x20 : actual) === expected;
    });
    if (!matches) continue;
    rewritten.set(to, offset);
    replacements += 1;
    offset += from.byteLength - 1;
  }
  return { bytes: rewritten, replacements };
}

/** Convert a QL-aware ZIP or QLPAK into a read-only QLAY Microdrive image. */
export async function importQlPackage(bytes, { name = "software.qlpak", microdrive = 1 } = {}) {
  if (!Number.isInteger(microdrive) || microdrive < 1 || microdrive > 8) {
    throw new RangeError("A unidade de destino deve estar entre MDV1 e MDV8.");
  }
  const entries = await readZipArchive(bytes);
  const config = parseConfig(entries);
  const configuredRoot = (config.pakdir1 ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  const rootPrefix = configuredRoot ? `${configuredRoot}/`.toLocaleLowerCase("en") : "";
  const packageFiles = entries.filter((entry) => {
    const lower = entry.name.toLocaleLowerCase("en");
    if (lower.endsWith(".qcf")) return false;
    return !rootPrefix || lower.startsWith(rootPrefix);
  });
  if (packageFiles.length === 0) throw new Error("O pacote não contém ficheiros acessíveis ao QL.");

  const sourceDevice = (config.floppyname ?? "flp").slice(0, 3).toLocaleLowerCase("en");
  let bootReplacements = 0;
  const files = packageFiles.map((entry) => {
    const relative = rootPrefix ? entry.name.slice(configuredRoot.length + 1) : entry.name;
    const inline = removeInlineHeader(entry.bytes);
    const metadata = { ...parseQdosExtra(entry.extra), ...inline.metadata };
    let content = inline.bytes;
    const targetName = qlName(relative);
    if (targetName.toLocaleLowerCase("en") === "boot") {
      const rewritten = rewriteBootDevice(content, sourceDevice, microdrive);
      content = rewritten.bytes;
      bootReplacements += rewritten.replacements;
    }
    return { name: targetName, bytes: content, ...metadata };
  });

  const baseName = name.replace(/\.(?:qlpak|zip)$/iu, "") || "QLPACKAGE";
  const image = buildMicrodriveImage(files, { mediumName: baseName.slice(0, 10) });
  return { image, files, config, bootReplacements };
}
