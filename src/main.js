import { QLBus } from "./core/bus.js";
import { MC68008 } from "./core/mc68008.js";
import { ZX8301, ZX8301_DISPLAY } from "./devices/zx8301.js";
import { ZX8302 } from "./devices/zx8302.js";
import { qlKeyDefinition } from "./ui/ql-keyboard.js";
import {
  adjacentPresentationMode,
  normalizePresentationMode,
  presentationLabel,
} from "./ui/presentation-mode.js";

const DEFAULT_ROM = "./roms/minerva/minerva-1.98a1.bin";
const CPU_HZ = 7_500_000;
const MAX_FRAME_CYCLES = CPU_HZ / 20;

const zx8301 = new ZX8301();
const zx8302 = new ZX8302();
const bus = new QLBus({ devices: [zx8301, zx8302] });
const cpu = new MC68008(bus);
const romInput = document.querySelector("#rom-file");
const microdriveInput = document.querySelector("#mdv-file");
const ejectMicrodriveButton = document.querySelector("#eject-mdv");
const status = document.querySelector("#status");
const runButton = document.querySelector("#run");
const stepButton = document.querySelector("#step");
const resetButton = document.querySelector("#reset");
const fullscreenButton = document.querySelector("#fullscreen");
const computerStage = document.querySelector(".computer-stage");
const presentationButtons = [...document.querySelectorAll("[data-presentation-option]")];
const screenMessage = document.querySelector("#screen-message");
const canvas = document.querySelector("#screen");
const context = canvas.getContext("2d", { alpha: false });
const image = context.createImageData(ZX8301_DISPLAY.width, ZX8301_DISPLAY.height);

let running = false;
let lastFrameTime = performance.now();
let loadedRomName = "";
let animationFrameId = null;

const PRESENTATION_STORAGE_KEY = "sinclair-ql-presentation";

function hexadecimal(value, width = 8) {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function updateControls() {
  const enabled = bus.romLoaded;
  runButton.disabled = !enabled;
  stepButton.disabled = !enabled || running;
  resetButton.disabled = !enabled;
  ejectMicrodriveButton.disabled = !zx8302.microdriveAt(1);
  runButton.textContent = running ? "Pausar" : "Executar";
  runButton.dataset.running = String(running);
}

function storePresentationMode(mode) {
  try {
    localStorage.setItem(PRESENTATION_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
}

function setPresentationMode(value, { persist = true, focus = false } = {}) {
  const mode = normalizePresentationMode(value);
  computerStage.dataset.presentation = mode;
  computerStage.setAttribute("aria-label", presentationLabel(mode));

  for (const button of presentationButtons) {
    const selected = button.dataset.presentationOption === mode;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }

  if (persist) storePresentationMode(mode);
}

function initialPresentationMode() {
  try {
    return normalizePresentationMode(localStorage.getItem(PRESENTATION_STORAGE_KEY));
  } catch {
    return "monitor";
  }
}

function updateFullscreenControl() {
  const active = document.fullscreenElement === computerStage;
  fullscreenButton.setAttribute("aria-pressed", String(active));
  fullscreenButton.textContent = active ? "Sair do ecrã inteiro" : "Ecrã inteiro";
  fullscreenButton.setAttribute(
    "aria-label",
    active ? "Sair do modo de ecrã inteiro" : "Mostrar a apresentação em ecrã inteiro",
  );
}

function cpuStatus(prefix) {
  return `${prefix} — PC=${hexadecimal(cpu.pc)}, ciclos=${cpu.cycles.toLocaleString("pt-PT")}, `
    + `vídeo=MODE ${zx8301.mode}${zx8301.blanked ? " (apagado)" : ""}, `
    + `banco=${hexadecimal(zx8301.screenBase, 5)}.`;
}

function render(time = performance.now()) {
  const flashPhase = Math.floor(time / 640) % 2 === 1;
  zx8301.renderFrame(bus, { flashPhase, target: image.data });
  context.putImageData(image, 0, 0);
}

function stop(message, kind = "ready") {
  running = false;
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
  updateControls();
  if (message) setStatus(message, kind);
}

function resetMachine() {
  stop();
  bus.resetRam();
  bus.resetDevices();
  cpu.reset();
  render();
  screenMessage.hidden = true;
  setStatus(cpuStatus(`${loadedRomName} reiniciada`), "ready");
}

function installRom(bytes, name) {
  bus.loadRom(bytes);
  loadedRomName = name;
  resetMachine();
  canvas.focus();
}

async function loadDefaultRom() {
  try {
    const response = await fetch(DEFAULT_ROM);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    installRom(new Uint8Array(await response.arrayBuffer()), "Minerva 1.98a1");
  } catch (error) {
    screenMessage.textContent = "Não foi possível carregar a Minerva";
    setStatus(`Falha ao carregar a ROM incluída: ${error.message}. Pode selecionar outra ROM.`, "error");
  }
}

function runFrame(time) {
  animationFrameId = null;
  if (!running) return;
  const elapsed = Math.min((time - lastFrameTime) / 1000, 0.05);
  const cycleBudget = Math.min(Math.max(elapsed * CPU_HZ, 1), MAX_FRAME_CYCLES);
  const targetCycles = cpu.cycles + cycleBudget;

  try {
    while (running && cpu.cycles < targetCycles) {
      const cycles = cpu.step();
      bus.tick(cycles);
      cpu.setInterruptLevel(bus.interruptLevel);
      if (cycles === 0 && cpu.stopped) {
        stop(cpuStatus("CPU em STOP"));
        break;
      }
    }
    render(time);
  } catch (error) {
    stop(`${error.name}: ${error.message}`, "error");
  }

  lastFrameTime = time;
  if (running) animationFrameId = requestAnimationFrame(runFrame);
}

romInput.addEventListener("change", async () => {
  const [file] = romInput.files;
  if (!file) return;

  try {
    installRom(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (error) {
    stop(error.message, "error");
  }
});

microdriveInput.addEventListener("change", async () => {
  const [file] = microdriveInput.files;
  if (!file) return;

  try {
    zx8302.mountMicrodrive(1, new Uint8Array(await file.arrayBuffer()), { name: file.name });
    resetMachine();
    setStatus(
      `${file.name} montado em MDV1, apenas para leitura. Prima F1 ou F2 para arrancar.`,
      "ready",
    );
  } catch (error) {
    setStatus(`Não foi possível montar o cartucho: ${error.message}`, "error");
  } finally {
    microdriveInput.value = "";
    updateControls();
  }
});

ejectMicrodriveButton.addEventListener("click", () => {
  const image = zx8302.unmountMicrodrive(1);
  updateControls();
  setStatus(image ? `${image.name} ejetado de MDV1.` : "MDV1 já se encontra vazio.", "ready");
});

runButton.addEventListener("click", () => {
  if (running) {
    stop(cpuStatus("Execução pausada"));
    return;
  }
  running = true;
  lastFrameTime = performance.now();
  updateControls();
  setStatus(cpuStatus("Em execução"), "ready");
  animationFrameId = requestAnimationFrame(runFrame);
});

stepButton.addEventListener("click", () => {
  try {
    const cycles = cpu.step();
    bus.tick(cycles);
    cpu.setInterruptLevel(bus.interruptLevel);
    render();
    const exception = cpu.lastException ? `, vetor=${cpu.lastException.vector}` : "";
    setStatus(`${cpuStatus("Passo concluído")} Último passo=${cycles} ciclos${exception}`, "ready");
  } catch (error) {
    stop(`${error.name}: ${error.message}`, "error");
  }
});

resetButton.addEventListener("click", resetMachine);

canvas.addEventListener("keydown", (event) => {
  const key = qlKeyDefinition(event);
  if (!key) return;
  zx8302.enqueueKey(key.keyrow, key);
  event.preventDefault();
});

document.querySelector(".screen-panel").addEventListener("click", () => canvas.focus());

for (const button of presentationButtons) {
  button.addEventListener("click", () => {
    setPresentationMode(button.dataset.presentationOption);
  });

  button.addEventListener("keydown", (event) => {
    let mode = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      mode = adjacentPresentationMode(computerStage.dataset.presentation, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      mode = adjacentPresentationMode(computerStage.dataset.presentation, -1);
    } else if (event.key === "Home") {
      mode = "screen";
    } else if (event.key === "End") {
      mode = "computer";
    }

    if (!mode) return;
    event.preventDefault();
    setPresentationMode(mode, { focus: true });
  });
}

if (typeof computerStage.requestFullscreen !== "function") {
  fullscreenButton.hidden = true;
} else {
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement === computerStage) await document.exitFullscreen();
      else await computerStage.requestFullscreen();
    } catch {
      setStatus("O navegador não permitiu ativar o ecrã inteiro.", "error");
    }
  });
  document.addEventListener("fullscreenchange", updateFullscreenControl);
}

setPresentationMode(initialPresentationMode(), { persist: false });
updateFullscreenControl();
updateControls();
render();
loadDefaultRom();
