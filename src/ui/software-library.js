export const MICRODRIVE_COUNT = 8;

const SOFTWARE_FORMATS = Object.freeze({
  mdv: "Microdrive",
  qlpak: "QLPAK",
  zip: "ZIP QDOS",
});

function extensionOf(name) {
  const match = String(name).toLocaleLowerCase("en").match(/\.([^.]+)$/u);
  return match?.[1] ?? "";
}

export function softwareFormat(name) {
  return SOFTWARE_FORMATS[extensionOf(name)] ?? null;
}

export function softwareFileKey(file) {
  const path = file.webkitRelativePath || file.name;
  return `${path}\u0000${file.size}\u0000${file.lastModified ?? 0}`;
}

export function supportedSoftwareFiles(files) {
  return [...files]
    .filter((file) => softwareFormat(file.name))
    .sort((left, right) => {
      const leftPath = left.webkitRelativePath || left.name;
      const rightPath = right.webkitRelativePath || right.name;
      return leftPath.localeCompare(rightPath, "pt", { numeric: true, sensitivity: "base" });
    });
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("pt-PT", {
    maximumFractionDigits: 1,
  })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-PT", {
    maximumFractionDigits: 1,
  })} MB`;
}

export function microdriveName(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > MICRODRIVE_COUNT) {
    throw new RangeError(`A unidade deve estar entre MDV1 e MDV${MICRODRIVE_COUNT}.`);
  }
  return `MDV${slot}`;
}
