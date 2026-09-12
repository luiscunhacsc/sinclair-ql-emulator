import { QLBus } from "./core/bus.js";
import { MC68008 } from "./core/mc68008.js";

const bus = new QLBus();
const cpu = new MC68008(bus);
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
    cpu.reset();
    setStatus(
      `ROM carregada: ${file.name}. CPU reiniciada em PC=0x${cpu.pc
        .toString(16)
        .padStart(8, "0")}, SSP=0x${cpu.a[7].toString(16).padStart(8, "0")}.`,
      "ready",
    );
    runButton.disabled = false;
  } catch (error) {
    setStatus(error.message, "error");
    runButton.disabled = true;
  }
});

runButton.addEventListener("click", () => {
  try {
    const cycles = cpu.step();
    const exception = cpu.lastException
      ? `; último vetor: ${cpu.lastException.vector}`
      : "";
    setStatus(
      `Passo concluído — PC=0x${cpu.pc.toString(16).padStart(8, "0")}; ` +
        `ciclos=${cycles}${exception}.`,
      "ready",
    );
  } catch (error) {
    setStatus(`${error.name}: ${error.message}`, "error");
  }
});
