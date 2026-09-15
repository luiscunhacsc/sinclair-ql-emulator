import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFileSize,
  MICRODRIVE_COUNT,
  microdriveName,
  softwareFileKey,
  softwareFormat,
  supportedSoftwareFiles,
} from "../src/ui/software-library.js";

test("reconhece apenas os três formatos de software suportados", () => {
  assert.equal(softwareFormat("jogo.MDV"), "Microdrive");
  assert.equal(softwareFormat("jogo.qlpak"), "QLPAK");
  assert.equal(softwareFormat("arquivo.ZIP"), "ZIP QDOS");
  assert.equal(softwareFormat("manual.txt"), null);
  assert.equal(softwareFormat("sem-extensao"), null);
});

test("filtra e ordena ficheiros escolhidos numa pasta", () => {
  const files = [
    { name: "Jogo10.qlpak", size: 10, webkitRelativePath: "QL/Jogo10.qlpak" },
    { name: "notas.txt", size: 20, webkitRelativePath: "QL/notas.txt" },
    { name: "Jogo2.mDV", size: 30, webkitRelativePath: "QL/Jogo2.mDV" },
  ];
  assert.deepEqual(
    supportedSoftwareFiles(files).map((file) => file.name),
    ["Jogo2.mDV", "Jogo10.qlpak"],
  );
});

test("distingue ficheiros homónimos em pastas diferentes", () => {
  const left = { name: "boot.zip", size: 42, lastModified: 7, webkitRelativePath: "A/boot.zip" };
  const right = { ...left, webkitRelativePath: "B/boot.zip" };
  assert.notEqual(softwareFileKey(left), softwareFileKey(right));
});

test("apresenta tamanhos legíveis e valida os nomes MDV1 a MDV8", () => {
  assert.equal(formatFileSize(512), "512 B");
  assert.match(formatFileSize(1536), /1[,.]5 KB/u);
  assert.equal(microdriveName(1), "MDV1");
  assert.equal(microdriveName(MICRODRIVE_COUNT), "MDV8");
  assert.throws(() => microdriveName(0), /MDV1.*MDV8/u);
  assert.throws(() => microdriveName(9), /MDV1.*MDV8/u);
});
