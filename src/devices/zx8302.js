const TRANSMIT_CONTROL = 0x18_002;
const IPC_WRITE = 0x18_003;
const IPC_READ = 0x18_020;
const INTERRUPT_REGISTER = 0x18_021;

// With no Microdrive running, the GAP input is high.  COMCTL (bit 6) is low
// once the IPC has consumed the bit; bit 7 is the return bit from the IPC.
const IDLE_IPC_STATUS = 0x08;
const FRAME_INTERRUPT = 0x08;
const GAP_INTERRUPT = 0x01;
const GAP_INTERRUPT_MASK = 0x20;
const IPC_STATUS_COMMAND = 0x01;
const IPC_READ_SERIAL_1_COMMAND = 0x06;
const IPC_READ_SERIAL_2_COMMAND = 0x07;
const IPC_READ_KEYBOARD_COMMAND = 0x08;
const IPC_DIRECT_KEYBOARD_COMMAND = 0x09;
const IPC_SOUND_COMMAND = 0x0a;
const IPC_MDV_SENSITIVITY_COMMAND = 0x0c;
const IPC_BAUD_COMMAND = 0x0d;
const IPC_RANDOM_COMMAND = 0x0e;
const IPC_TEST_COMMAND = 0x0f;
const CPU_HZ = 7_500_000;
const FRAME_HZ = 50;
const FRAME_CYCLES = CPU_HZ / FRAME_HZ;

/**
 * Initial ZX8302 peripheral-controller register block.
 *
 * This models the synchronous IPC-link protocol and its keyboard buffer. The
 * sound and serial commands are consumed so that the bit stream stays aligned,
 * but their peripherals remain intentionally inert.
 */
export class ZX8302 {
  constructor() {
    this.reset();
  }

  reset() {
    this.transmitControl = 0;
    this.interruptMask = 0;
    this.ipcWrite = 0;
    this.ipcWrites = 0;
    this.ipcCommandBits = [];
    this.ipcArgumentBits = [];
    this.ipcArgumentBitsRemaining = 0;
    this.ipcCommand = null;
    this.ipcResponseBits = [];
    this.ipcReturnBit = 0;
    this.keyboardQueue = [];
    this.pendingInterrupts = 0;
    this.frameCycleAccumulator = 0;
  }

  handles(address) {
    return address === TRANSMIT_CONTROL
      || address === IPC_WRITE
      || address === IPC_READ
      || address === INTERRUPT_REGISTER;
  }

  read8(address) {
    if (address === IPC_READ) return IDLE_IPC_STATUS | (this.ipcReturnBit << 7);
    if (address === INTERRUPT_REGISTER) return this.pendingInterrupts;
    return 0xff;
  }

  write8(address, value) {
    if (address === TRANSMIT_CONTROL) {
      this.transmitControl = value & 0xff;
    } else if (address === IPC_WRITE) {
      this.ipcWrite = value & 0xff;
      this.ipcWrites += 1;
      this.receiveIpcBit(value);
    } else if (address === INTERRUPT_REGISTER) {
      // Bits 7..5 are masks; writing ones to bits 4..0 acknowledges sources.
      this.interruptMask = value & 0xe0;
      this.pendingInterrupts &= ~(value & 0x1f);
      // With no cartridge inserted the GAP input remains asserted. Enabling
      // its source therefore requests service immediately, as on a real QL.
      if (this.interruptMask & GAP_INTERRUPT_MASK) {
        this.pendingInterrupts |= GAP_INTERRUPT;
      }
    }
  }

  enqueueKey(keyrow, { shift = false, control = false, alt = false } = {}) {
    if (!Number.isInteger(keyrow) || keyrow < 0 || keyrow > 0x3f) {
      throw new RangeError("A tecla do QL deve estar entre 0 e 63.");
    }
    const modifiers = (shift ? 0x04 : 0) | (control ? 0x02 : 0) | (alt ? 0x01 : 0);
    this.keyboardQueue.push({ keyrow, modifiers });
  }

  receiveIpcBit(value) {
    // Normal transfers use %110x in the low nibble. The boot-time $01 write
    // is an electrical initialisation pulse rather than a protocol bit.
    if ((value & 0x0d) !== 0x0c) return;

    if (this.ipcResponseBits.length > 0) {
      this.ipcReturnBit = this.ipcResponseBits.shift();
      return;
    }

    this.ipcReturnBit = 0;
    const bit = (value >>> 1) & 1;
    if (this.ipcArgumentBitsRemaining > 0) {
      this.ipcArgumentBits.push(bit);
      this.ipcArgumentBitsRemaining -= 1;
      if (this.ipcArgumentBitsRemaining === 0) this.finishIpcArguments();
      return;
    }

    this.ipcCommandBits.push(bit);
    if (this.ipcCommandBits.length < 4) return;
    const command = this.bitsToNumber(this.ipcCommandBits);
    this.ipcCommandBits = [];
    this.startIpcCommand(command);
  }

  startIpcCommand(command) {
    this.ipcCommand = command;
    if (command === IPC_STATUS_COMMAND) {
      this.setIpcResponse(this.keyboardQueue.length > 0 ? 0x01 : 0x00, 8);
    } else if (command === IPC_READ_KEYBOARD_COMMAND) {
      const keys = this.keyboardQueue.splice(0, 7);
      this.ipcResponseBits.push(...this.numberToBits(keys.length, 4));
      for (const key of keys) {
        this.ipcResponseBits.push(...this.numberToBits(key.modifiers, 4));
        this.ipcResponseBits.push(...this.numberToBits(key.keyrow, 8));
      }
      this.ipcCommand = null;
    } else if (command === IPC_READ_SERIAL_1_COMMAND || command === IPC_READ_SERIAL_2_COMMAND) {
      this.setIpcResponse(0, 8);
    } else if (command === IPC_DIRECT_KEYBOARD_COMMAND) {
      this.expectIpcArguments(4);
    } else if (command === IPC_SOUND_COMMAND) {
      this.expectIpcArguments(64);
    } else if (command === IPC_MDV_SENSITIVITY_COMMAND || command === IPC_BAUD_COMMAND) {
      this.expectIpcArguments(4);
    } else if (command === IPC_RANDOM_COMMAND) {
      this.setIpcResponse(0, 16);
    } else if (command === IPC_TEST_COMMAND) {
      this.expectIpcArguments(8);
    } else {
      this.ipcCommand = null;
    }
  }

  expectIpcArguments(count) {
    this.ipcArgumentBits = [];
    this.ipcArgumentBitsRemaining = count;
  }

  finishIpcArguments() {
    const argument = this.bitsToNumber(this.ipcArgumentBits);
    this.ipcArgumentBits = [];
    if (this.ipcCommand === IPC_DIRECT_KEYBOARD_COMMAND) this.setIpcResponse(0, 8);
    else if (this.ipcCommand === IPC_TEST_COMMAND) this.setIpcResponse(argument, 8);
    else this.ipcCommand = null;
  }

  setIpcResponse(value, width) {
    this.ipcResponseBits.push(...this.numberToBits(value, width));
    this.ipcCommand = null;
  }

  numberToBits(value, width) {
    return Array.from({ length: width }, (_, index) => (value >>> (width - index - 1)) & 1);
  }

  bitsToNumber(bits) {
    return bits.reduce((value, bit) => (value << 1) | bit, 0) >>> 0;
  }

  tick(cycles) {
    if (!Number.isFinite(cycles) || cycles < 0) {
      throw new RangeError("O avanço do ZX8302 requer um número de ciclos não negativo.");
    }
    this.frameCycleAccumulator += cycles;
    if (this.frameCycleAccumulator < FRAME_CYCLES) return;
    this.frameCycleAccumulator %= FRAME_CYCLES;
    this.pendingInterrupts |= FRAME_INTERRUPT;
  }

  get interruptLevel() {
    return this.pendingInterrupts ? 2 : 0;
  }
}

export const ZX8302_REGISTERS = Object.freeze({
  transmitControl: TRANSMIT_CONTROL,
  ipcWrite: IPC_WRITE,
  ipcRead: IPC_READ,
  interrupt: INTERRUPT_REGISTER,
  idleIpcStatus: IDLE_IPC_STATUS,
  frameInterrupt: FRAME_INTERRUPT,
  gapInterrupt: GAP_INTERRUPT,
  gapInterruptMask: GAP_INTERRUPT_MASK,
  frameCycles: FRAME_CYCLES,
});
