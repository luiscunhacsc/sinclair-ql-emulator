const ADDRESS_MASK = 0x0f_ffff;
const SR_TRACE = 0x8000;
const SR_SUPERVISOR = 0x2000;
const SR_INTERRUPT_MASK = 0x0700;
const SR_EXTEND = 0x0010;
const SR_NEGATIVE = 0x0008;
const SR_ZERO = 0x0004;
const SR_OVERFLOW = 0x0002;
const SR_CARRY = 0x0001;
const SR_IMPLEMENTED = 0xa71f;

export const M68K_VECTOR = Object.freeze({
  RESET_STACK_POINTER: 0,
  RESET_PROGRAM_COUNTER: 1,
  BUS_ERROR: 2,
  ADDRESS_ERROR: 3,
  ILLEGAL_INSTRUCTION: 4,
  PRIVILEGE_VIOLATION: 8,
});

export const M68K_SR = Object.freeze({
  TRACE: SR_TRACE,
  SUPERVISOR: SR_SUPERVISOR,
  INTERRUPT_MASK: SR_INTERRUPT_MASK,
  EXTEND: SR_EXTEND,
  NEGATIVE: SR_NEGATIVE,
  ZERO: SR_ZERO,
  OVERFLOW: SR_OVERFLOW,
  CARRY: SR_CARRY,
});

export class AddressError extends Error {
  constructor(address, operation) {
    super(`Acesso ${operation} não alinhado em 0x${address.toString(16)}.`);
    this.name = "AddressError";
    this.address = address >>> 0;
    this.operation = operation;
    this.vector = M68K_VECTOR.ADDRESS_ERROR;
  }
}

function signExtend8(value) {
  return value & 0x80 ? value | 0xffff_ff00 : value;
}

function signExtend16(value) {
  return value & 0x8000 ? value | 0xffff_0000 : value;
}

export class MC68008 {
  constructor(bus) {
    this.bus = bus;
    this.d = new Uint32Array(8);
    this.a = new Uint32Array(8);
    this.pc = 0;
    this.sr = 0x2700;
    this.usp = 0;
    this.ssp = 0;
    this.cycles = 0;
    this.stopped = false;
    this.lastException = null;
  }

  reset() {
    this.d.fill(0);
    this.a.fill(0);
    this.sr = 0x2700;
    this.usp = 0;
    this.cycles = 0;
    this.stopped = false;
    this.lastException = null;
    this.ssp = this.read32(0);
    this.a[7] = this.ssp;
    this.pc = this.read32(4);
  }

  get supervisor() {
    return Boolean(this.sr & SR_SUPERVISOR);
  }

  setStatusRegister(value) {
    const next = value & SR_IMPLEMENTED;
    const wasSupervisor = this.supervisor;
    const willBeSupervisor = Boolean(next & SR_SUPERVISOR);

    if (wasSupervisor !== willBeSupervisor) {
      if (wasSupervisor) {
        this.ssp = this.a[7];
        this.a[7] = this.usp;
      } else {
        this.usp = this.a[7];
        this.a[7] = this.ssp;
      }
    }
    this.sr = next;
  }

  read8(address) {
    this.cycles += 4;
    return this.bus.read8(address);
  }

  read16(address) {
    if (address & 1) throw new AddressError(address, "de palavra");
    return (this.read8(address) << 8) | this.read8(address + 1);
  }

  read32(address) {
    if (address & 1) throw new AddressError(address, "de palavra longa");
    return (this.read16(address) * 0x1_0000 + this.read16(address + 2)) >>> 0;
  }

  write8(address, value) {
    this.cycles += 4;
    this.bus.write8(address, value);
  }

  write16(address, value) {
    if (address & 1) throw new AddressError(address, "de escrita de palavra");
    this.write8(address, value >>> 8);
    this.write8(address + 1, value);
  }

  write32(address, value) {
    if (address & 1) throw new AddressError(address, "de escrita de palavra longa");
    this.write16(address, value >>> 16);
    this.write16(address + 2, value);
  }

  fetch16() {
    const value = this.read16(this.pc);
    this.pc = (this.pc + 2) >>> 0;
    return value;
  }

  push16(value) {
    this.a[7] = (this.a[7] - 2) >>> 0;
    this.write16(this.a[7], value);
  }

  push32(value) {
    this.a[7] = (this.a[7] - 4) >>> 0;
    this.write32(this.a[7], value);
  }

  pop16() {
    const value = this.read16(this.a[7]);
    this.a[7] = (this.a[7] + 2) >>> 0;
    return value;
  }

  pop32() {
    const value = this.read32(this.a[7]);
    this.a[7] = (this.a[7] + 4) >>> 0;
    return value;
  }

  exception(vector, stackedPc = this.pc) {
    const previousSr = this.sr;
    if (!this.supervisor) this.setStatusRegister(this.sr | SR_SUPERVISOR);
    this.sr &= ~SR_TRACE;
    this.push32(stackedPc);
    this.push16(previousSr);
    this.pc = this.read32(vector * 4);
    this.stopped = false;
    this.lastException = { vector, pc: stackedPc >>> 0 };
  }

  conditionTrue(condition) {
    const carry = Boolean(this.sr & SR_CARRY);
    const overflow = Boolean(this.sr & SR_OVERFLOW);
    const zero = Boolean(this.sr & SR_ZERO);
    const negative = Boolean(this.sr & SR_NEGATIVE);

    switch (condition & 0x0f) {
      case 0x0: return true;
      case 0x1: return false;
      case 0x2: return !carry && !zero;
      case 0x3: return carry || zero;
      case 0x4: return !carry;
      case 0x5: return carry;
      case 0x6: return !zero;
      case 0x7: return zero;
      case 0x8: return !overflow;
      case 0x9: return overflow;
      case 0xa: return !negative;
      case 0xb: return negative;
      case 0xc: return negative === overflow;
      case 0xd: return negative !== overflow;
      case 0xe: return !zero && negative === overflow;
      case 0xf: return zero || negative !== overflow;
      default: return false;
    }
  }

  executeBranch(opcode) {
    const condition = (opcode >>> 8) & 0x0f;
    const encodedDisplacement = opcode & 0xff;
    const displacement = encodedDisplacement === 0
      ? signExtend16(this.fetch16())
      : signExtend8(encodedDisplacement);
    const returnAddress = this.pc;

    if (condition === 1) {
      this.push32(returnAddress);
      this.pc = (this.pc + displacement) >>> 0;
      this.cycles += 2;
    } else if (this.conditionTrue(condition)) {
      this.pc = (this.pc + displacement) >>> 0;
      this.cycles += 2;
    } else {
      this.cycles += encodedDisplacement === 0 ? 4 : 0;
    }
  }

  executeMoveQ(opcode) {
    const register = (opcode >>> 9) & 0x07;
    const value = signExtend8(opcode & 0xff) >>> 0;
    this.d[register] = value;
    this.sr &= ~(SR_NEGATIVE | SR_ZERO | SR_OVERFLOW | SR_CARRY);
    if (value === 0) this.sr |= SR_ZERO;
    if (value & 0x8000_0000) this.sr |= SR_NEGATIVE;
  }

  step() {
    if (this.stopped) return 0;
    const initialCycles = this.cycles;
    const opcodeAddress = this.pc;
    const opcode = this.fetch16();

    if (opcode === 0x4e71) {
      // NOP: on the MC68008 the 16-bit opcode fetch itself takes eight clocks.
    } else if (opcode === 0x4e75) {
      this.pc = this.pop32();
    } else if ((opcode & 0xf000) === 0x6000) {
      this.executeBranch(opcode);
    } else if ((opcode & 0xf100) === 0x7000) {
      this.executeMoveQ(opcode);
    } else {
      this.exception(M68K_VECTOR.ILLEGAL_INSTRUCTION, opcodeAddress);
    }

    return this.cycles - initialCycles;
  }

  externalAddress(address) {
    return address & ADDRESS_MASK;
  }
}
