import { QLBus, QL_MEMORY } from "./core/bus.js";

const bus = new QLBus();
const romInput = document.querySelector("#rom-file");
const status = document.querySelector("#status");
const runButton = document.querySelector("#run");

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

romInput.addEventListener("change", async () => {
  const [file] = romInput.files;
  if (!file) return;

  try {
    bus.loadRom(new Uint8Array(await file.arrayBuffer()));
    setStatus(`ROM carregada: ${file.name} (${file.size} bytes).`, "ready");
    runButton.disabled = false;
  } catch (error) {
    setStatus(error.message, "error");
    runButton.disabled = true;
  }
});

runButton.addEventListener("click", () => {
  const initialStackPointer = bus.read32(0);
  const initialProgramCounter = bus.read32(4) & QL_MEMORY.addressMask;
  setStatus(
    `Vetores lidos — SP: 0x${initialStackPointer.toString(16).padStart(8, "0")}; ` +
      `PC: 0x${initialProgramCounter.toString(16).padStart(5, "0")}. ` +
      "O núcleo MC68008 será o próximo componente.",
    "ready",
  );
});

