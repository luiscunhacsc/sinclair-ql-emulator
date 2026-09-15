import { QLBus } from "./core/bus.js";
import { MC68008 } from "./core/mc68008.js";
import { ZX8301, ZX8301_DISPLAY } from "./devices/zx8301.js";
import { ZX8302 } from "./devices/zx8302.js";
import { MICRODRIVE_FORMAT } from "./devices/microdrive.js";
import { importQlPackage } from "./formats/ql-package.js";
import { computerFrameSource } from "./ui/computer-frame.js";
import { QLAudio } from "./ui/ql-audio.js";
import { qlKeyDefinition } from "./ui/ql-keyboard.js";
import {
  adjacentPresentationMode,
  normalizePresentationMode,
  presentationLabel,
} from "./ui/presentation-mode.js";
import {
  formatFileSize,
  MICRODRIVE_COUNT,
  microdriveName,
  softwareFileKey,
  softwareFormat,
  supportedSoftwareFiles,
} from "./ui/software-library.js";

const DEFAULT_ROM = "./roms/minerva/minerva-1.98a1.bin";
const CPU_HZ = 7_500_000;
const MAX_FRAME_CYCLES = CPU_HZ / 20;
const PRESENTATION_STORAGE_KEY = "sinclair-ql-presentation";
const SOUND_STORAGE_KEY = "sinclair-ql-sound";

const zx8301 = new ZX8301();
const qlAudio = new QLAudio({ onStateChange: updateSoundControl });
const zx8302 = new ZX8302({ onSound: (event) => qlAudio.handleIpcEvent(event) });
const bus = new QLBus({ devices: [zx8301, zx8302] });
const cpu = new MC68008(bus);
const romInput = document.querySelector("#rom-file");
const openSoftwareLibraryButton = document.querySelector("#open-software-library");
const softwareLibrary = document.querySelector("#software-library");
const softwareFilesInput = document.querySelector("#software-files");
const softwareFolderInput = document.querySelector("#software-folder");
const newVirginMicrodriveButton = document.querySelector("#new-virgin-microdrive");
const softwareFileList = document.querySelector("#software-file-list");
const softwareCount = document.querySelector("#software-count");
const softwareDropzone = document.querySelector("#software-dropzone");
const microdriveRack = document.querySelector("#microdrive-rack");
const softwareLibraryStatus = document.querySelector("#software-library-status");
const status = document.querySelector("#status");
const runButton = document.querySelector("#run");
const stepButton = document.querySelector("#step");
const resetButton = document.querySelector("#reset");
const soundButton = document.querySelector("#sound-toggle");
const fullscreenButton = document.querySelector("#fullscreen");
const computerStage = document.querySelector(".computer-stage");
const fullSystemFrame = document.querySelector(".full-system-frame");
const presentationButtons = [...document.querySelectorAll("[data-presentation-option]")];
const screenMessage = document.querySelector("#screen-message");
const canvas = document.querySelector("#screen");
const context = canvas.getContext("2d", { alpha: false });
const image = context.createImageData(ZX8301_DISPLAY.width, ZX8301_DISPLAY.height);

let running = false;
let lastFrameTime = performance.now();
let loadedRomName = "";
let animationFrameId = null;
let selectedSoftwareKey = null;
let softwareBusy = false;
let virginMicrodriveCount = 0;

const softwareFiles = new Map();

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
  runButton.textContent = running ? "Pausar" : "Executar";
  runButton.dataset.running = String(running);
  renderMicrodriveRack();
}

function initialSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function storeSoundEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
}

function updateSoundControl() {
  if (!soundButton) return;
  const enabled = qlAudio.enabled && qlAudio.supported;
  soundButton.disabled = !qlAudio.supported;
  soundButton.setAttribute("aria-pressed", String(enabled));
  soundButton.querySelector(".sound-label").textContent = qlAudio.supported
    ? `Som ${enabled ? "ligado" : "desligado"}`
    : "Som indisponível";
}

function setSoftwareLibraryStatus(message, kind = "info") {
  softwareLibraryStatus.textContent = message;
  softwareLibraryStatus.dataset.kind = kind;
}

function selectedSoftwareFile() {
  return selectedSoftwareKey ? softwareFiles.get(selectedSoftwareKey) ?? null : null;
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSoftwareFiles() {
  softwareFileList.replaceChildren();
  softwareCount.textContent = String(softwareFiles.size);
  if (softwareFiles.size === 0) {
    softwareFileList.append(element(
      "p",
      "software-empty",
      "Escolha uma pasta ou adicione ficheiros MDV, QLPAK ou ZIP.",
    ));
    return;
  }

  for (const [key, file] of softwareFiles) {
    const button = element("button", "software-file");
    button.type = "button";
    button.dataset.softwareKey = key;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(key === selectedSoftwareKey));

    const identity = element("span", "software-file-identity");
    identity.append(element("span", "software-file-name", file.name));
    const path = file.webkitRelativePath || file.name;
    if (path !== file.name) identity.append(element("span", "software-file-path", path));
    button.append(identity);
    button.append(element(
      "span",
      "software-file-meta",
      `${softwareFormat(file.name)}\n${formatFileSize(file.size)}`,
    ));
    softwareFileList.append(button);
  }
}

function driveAction(label, action, slot, className = "") {
  const button = element("button", className, label);
  button.type = "button";
  button.dataset.driveAction = action;
  button.dataset.slot = String(slot);
  return button;
}

function renderMicrodriveRack() {
  const mdv1Mounted = Boolean(zx8302.microdriveAt(1));
  const mdv2Mounted = Boolean(zx8302.microdriveAt(2));
  const frameSource = computerFrameSource(mdv1Mounted, mdv2Mounted);
  if (fullSystemFrame.getAttribute("src") !== frameSource) {
    fullSystemFrame.setAttribute("src", frameSource);
  }
  computerStage.dataset.mdv1Mounted = String(mdv1Mounted);
  computerStage.dataset.mdv2Mounted = String(mdv2Mounted);

  if (!microdriveRack) return;
  microdriveRack.replaceChildren();
  const selected = selectedSoftwareFile();
  for (let slot = 1; slot <= MICRODRIVE_COUNT; slot += 1) {
    const mounted = zx8302.microdriveAt(slot);
    const card = element("article", "microdrive-card");
    card.append(element("span", "microdrive-number", microdriveName(slot)));
    const accessLabel = mounted?.writeProtected
      ? " • protegido"
      : mounted?.dirty ? " • alterado" : " • gravável";
    const mediumLabel = mounted
      ? `${mounted.name}${accessLabel}`
      : "unidade vazia";
    const medium = element("span", "microdrive-medium", mediumLabel);
    medium.dataset.empty = String(!mounted);
    medium.title = mounted?.name ?? "";
    card.append(medium);

    const actions = element("div", "microdrive-actions");
    const mount = driveAction(mounted ? "Substituir" : "Montar", "mount", slot, "mount-button");
    mount.disabled = !selected || softwareBusy;
    actions.append(mount);
    if (slot === 1) {
      const boot = driveAction("Montar e arrancar", "boot", slot, "boot-button");
      boot.disabled = !selected || softwareBusy || !bus.romLoaded;
      actions.append(boot);
    }
    if (mounted) {
      if (!mounted.writeProtected) {
        actions.append(driveAction("Guardar .mdv", "save", slot, "save-button"));
      }
      const eject = driveAction("Ejetar", "eject", slot, "eject-button");
      eject.disabled = softwareBusy;
      actions.append(eject);
    }
    card.append(actions);
    microdriveRack.append(card);
  }
}

function renderSoftwareLibrary() {
  renderSoftwareFiles();
  renderMicrodriveRack();
}

function addSoftwareFiles(files, { replace = false } = {}) {
  const candidates = [...files];
  const supported = supportedSoftwareFiles(candidates);
  if (replace) softwareFiles.clear();
  for (const file of supported) softwareFiles.set(softwareFileKey(file), file);
  if (!softwareFiles.has(selectedSoftwareKey)) {
    selectedSoftwareKey = softwareFiles.keys().next().value ?? null;
  }
  renderSoftwareLibrary();

  const ignored = candidates.length - supported.length;
  const message = `${supported.length} ficheiro(s) suportado(s) adicionado(s)`
    + (ignored ? `; ${ignored} ignorado(s).` : ".");
  setSoftwareLibraryStatus(message, supported.length ? "ready" : "error");
}

function createVirginMicrodrive() {
  virginMicrodriveCount += 1;
  const name = `cartucho-virgem-${virginMicrodriveCount}.mdv`;
  const bytes = new Uint8Array(MICRODRIVE_FORMAT.imageSize);
  const file = {
    name,
    size: bytes.byteLength,
    lastModified: Date.now(),
    webkitRelativePath: "",
    virgin: true,
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  };
  const key = softwareFileKey(file);
  softwareFiles.set(key, file);
  selectedSoftwareKey = key;
  renderSoftwareLibrary();
  setSoftwareLibraryStatus(
    `${name} criado e selecionado. Monte-o e use FORMAT mdvN_nome no SuperBASIC.`,
    "ready",
  );
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
  qlAudio.pause();
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
  updateControls();
  if (message) setStatus(message, kind);
}

function startExecution(message = cpuStatus("Em execução")) {
  if (!bus.romLoaded) return;
  void qlAudio.resume();
  running = true;
  lastFrameTime = performance.now();
  updateControls();
  setStatus(message, "ready");
  animationFrameId = requestAnimationFrame(runFrame);
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

async function mountSoftware(slot, { boot = false } = {}) {
  const file = selectedSoftwareFile();
  if (!file || softwareBusy) return;
  const drive = microdriveName(slot);
  const mounted = zx8302.microdriveAt(slot);
  if (mounted) {
    const warning = mounted.dirty ? " As alterações ainda não foram guardadas." : "";
    if (!window.confirm(`Substituir ${mounted.name} em ${drive} por ${file.name}?${warning}`)) return;
  }

  softwareBusy = true;
  renderMicrodriveRack();
  setSoftwareLibraryStatus(`A preparar ${file.name} para ${drive}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isMicrodrive = softwareFormat(file.name) === "Microdrive";
    let imageBytes = bytes;
    let packageSummary = "";
    if (!isMicrodrive) {
      const imported = await importQlPackage(bytes, { name: file.name, microdrive: slot });
      imageBytes = imported.image;
      packageSummary = ` ${imported.files.length} ficheiro(s) convertido(s)`
        + (imported.bootReplacements ? `; BOOT adaptado para ${drive}` : "")
        + ".";
    }

    zx8302.mountMicrodrive(slot, imageBytes, {
      name: file.name,
      writeProtected: !file.virgin,
      // Real cartridges contain a splice rather than 255 perfect sectors.
      // Keeping one physical slot outside the loop and one internal gap lets
      // FORMAT detect the same imperfect circumference as on real tape.
      physicalSectorCount: file.virgin ? MICRODRIVE_FORMAT.sectorCount - 1 : undefined,
      spliceSector: file.virgin ? Math.floor((MICRODRIVE_FORMAT.sectorCount - 1) / 2) : undefined,
    });
    const accessSummary = file.virgin
      ? ` montado em ${drive}, gravável. Use FORMAT mdv${slot}_nome antes de o utilizar.`
      : ` montado em ${drive}, apenas para leitura.`;
    const message = `${file.name}${accessSummary}${packageSummary}`;
    if (boot) {
      resetMachine();
      zx8302.enqueueKey(57);
      startExecution(`${message} A arrancar pela tecla F1…`);
      softwareLibrary.close();
      canvas.focus();
    } else {
      setStatus(message, "ready");
    }
    setSoftwareLibraryStatus(message, "ready");
  } catch (error) {
    const message = `Não foi possível montar ${file.name} em ${drive}: ${error.message}`;
    setStatus(message, "error");
    setSoftwareLibraryStatus(message, "error");
  } finally {
    softwareBusy = false;
    updateControls();
  }
}

function ejectMicrodrive(slot) {
  const drive = microdriveName(slot);
  const current = zx8302.microdriveAt(slot);
  if (
    current?.dirty
    && !window.confirm(`${current.name} tem alterações não guardadas. Ejetar mesmo assim?`)
  ) return;
  const image = zx8302.unmountMicrodrive(slot);
  updateControls();
  const message = image ? `${image.name} ejetado de ${drive}.` : `${drive} já se encontra vazio.`;
  setStatus(message, "ready");
  setSoftwareLibraryStatus(message, "ready");
}

function saveMicrodrive(slot) {
  const drive = microdriveName(slot);
  const image = zx8302.microdriveAt(slot);
  if (!image || image.writeProtected) return;
  const blob = new Blob([image.toUint8Array()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = image.name.toLocaleLowerCase("en").endsWith(".mdv")
    ? image.name
    : `${image.name}.mdv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  image.markClean();
  updateControls();
  const message = `${image.name}, de ${drive}, guardado como imagem .mdv.`;
  setStatus(message, "ready");
  setSoftwareLibraryStatus(message, "ready");
}

openSoftwareLibraryButton.addEventListener("click", () => {
  renderSoftwareLibrary();
  softwareLibrary.showModal();
  softwareFileList.querySelector('[aria-selected="true"]')?.focus();
});

softwareFilesInput.addEventListener("change", () => {
  addSoftwareFiles(softwareFilesInput.files);
  softwareFilesInput.value = "";
});

softwareFolderInput.addEventListener("change", () => {
  addSoftwareFiles(softwareFolderInput.files, { replace: true });
  softwareFolderInput.value = "";
});

newVirginMicrodriveButton.addEventListener("click", createVirginMicrodrive);

softwareFileList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-software-key]");
  if (!button) return;
  selectedSoftwareKey = button.dataset.softwareKey;
  renderSoftwareLibrary();
  setSoftwareLibraryStatus(`${selectedSoftwareFile().name} selecionado. Escolha uma unidade.`);
});

microdriveRack.addEventListener("click", (event) => {
  const button = event.target.closest("[data-drive-action]");
  if (!button || button.disabled) return;
  const slot = Number(button.dataset.slot);
  if (button.dataset.driveAction === "eject") ejectMicrodrive(slot);
  else if (button.dataset.driveAction === "save") saveMicrodrive(slot);
  else mountSoftware(slot, { boot: button.dataset.driveAction === "boot" });
});

for (const eventName of ["dragenter", "dragover"]) {
  softwareDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    softwareDropzone.dataset.dragging = "true";
  });
}
for (const eventName of ["dragleave", "drop"]) {
  softwareDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    softwareDropzone.dataset.dragging = "false";
  });
}
softwareDropzone.addEventListener("drop", (event) => addSoftwareFiles(event.dataTransfer.files));

window.addEventListener("beforeunload", (event) => {
  if (!zx8302.microdrives.some((medium) => medium?.dirty)) return;
  event.preventDefault();
  event.returnValue = "";
});

runButton.addEventListener("click", () => {
  if (running) {
    stop(cpuStatus("Execução pausada"));
    return;
  }
  startExecution();
});

soundButton.addEventListener("click", () => {
  const enabled = !qlAudio.enabled;
  qlAudio.setEnabled(enabled, zx8302.soundActive ? zx8302.sound : null);
  storeSoundEnabled(enabled);
  if (enabled && running) void qlAudio.resume();
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
  if (running) void qlAudio.resume();
  const key = qlKeyDefinition(event);
  if (!key) return;
  zx8302.enqueueKey(key.keyrow, key);
  event.preventDefault();
});

document.querySelector(".screen-panel").addEventListener("click", () => {
  if (running) void qlAudio.resume();
  canvas.focus();
});

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
qlAudio.setEnabled(initialSoundEnabled());
updateFullscreenControl();
updateControls();
render();
loadDefaultRom();
