const TRANSMIT_CONTROL = 0x18_002;
const IPC_WRITE = 0x18_003;
const IPC_READ = 0x18_020;
const INTERRUPT_REGISTER = 0x18_021;

// With no Microdrive running, the GAP input is high.  COMCTL (bit 6) is low
// once the IPC has consumed the bit; bit 7 is the return bit from the IPC.
const IDLE_IPC_STATUS = 0x08;

/**
 * Initial ZX8302 peripheral-controller register block.
 *
 * This deliberately models only the synchronous IPC-link handshake needed by
 * Minerva during cold start.  The 8049 command processor, keyboard queues,
 * sound and serial ports will be layered onto the same four registers later.
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
  }

  handles(address) {
    return address === TRANSMIT_CONTROL
      || address === IPC_WRITE
      || address === IPC_READ
      || address === INTERRUPT_REGISTER;
  }

  read8(address) {
    if (address === IPC_READ) return IDLE_IPC_STATUS;
    if (address === INTERRUPT_REGISTER) return 0;
    return 0xff;
  }

  write8(address, value) {
    if (address === TRANSMIT_CONTROL) {
      this.transmitControl = value & 0xff;
    } else if (address === IPC_WRITE) {
      this.ipcWrite = value & 0xff;
      this.ipcWrites += 1;
    } else if (address === INTERRUPT_REGISTER) {
      // Bits 7..5 are masks; writing ones to bits 4..0 acknowledges sources.
      this.interruptMask = value & 0xe0;
    }
  }
}

export const ZX8302_REGISTERS = Object.freeze({
  transmitControl: TRANSMIT_CONTROL,
  ipcWrite: IPC_WRITE,
  ipcRead: IPC_READ,
  interrupt: INTERRUPT_REGISTER,
  idleIpcStatus: IDLE_IPC_STATUS,
});
