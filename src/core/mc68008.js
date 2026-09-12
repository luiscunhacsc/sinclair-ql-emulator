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
const SIZE_BYTE = 1;
const SIZE_WORD = 2;
const SIZE_LONG = 4;

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

class IllegalEffectiveAddress extends Error {}

function signExtend8(value) {
  return value & 0x80 ? value | 0xffff_ff00 : value;
}

function signExtend16(value) {
  return value & 0x8000 ? value | 0xffff_0000 : value;
}

function maskForSize(size) {
  if (size === SIZE_BYTE) return 0xff;
  if (size === SIZE_WORD) return 0xffff;
  return 0xffff_ffff;
}

function signBitForSize(size) {
  if (size === SIZE_BYTE) return 0x80;
  if (size === SIZE_WORD) return 0x8000;
  return 0x8000_0000;
}

function sizeFromCode(code) {
  return [SIZE_BYTE, SIZE_WORD, SIZE_LONG][code] ?? null;
}

function signExtend(value, size) {
  if (size === SIZE_BYTE) return signExtend8(value);
  if (size === SIZE_WORD) return signExtend16(value);
  return value >>> 0;
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

  readSize(address, size) {
    if (size === SIZE_BYTE) return this.read8(address);
    if (size === SIZE_WORD) return this.read16(address);
    return this.read32(address);
  }

  writeSize(address, size, value) {
    if (size === SIZE_BYTE) this.write8(address, value);
    else if (size === SIZE_WORD) this.write16(address, value);
    else this.write32(address, value);
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

  writeDataRegister(register, size, value) {
    const mask = maskForSize(size);
    this.d[register] = size === SIZE_LONG
      ? value >>> 0
      : ((this.d[register] & ~mask) | (value & mask)) >>> 0;
  }

  indexValue(extension) {
    const register = (extension >>> 12) & 0x07;
    const fromAddressRegister = Boolean(extension & 0x8000);
    const isLong = Boolean(extension & 0x0800);
    const raw = fromAddressRegister ? this.a[register] : this.d[register];
    return isLong ? raw | 0 : signExtend16(raw & 0xffff);
  }

  memoryOperand(address, size, postIncrementRegister = null) {
    let adjusted = false;
    const adjust = () => {
      if (adjusted || postIncrementRegister === null) return;
      const increment = size === SIZE_BYTE && postIncrementRegister === 7 ? 2 : size;
      this.a[postIncrementRegister] = (this.a[postIncrementRegister] + increment) >>> 0;
      adjusted = true;
    };

    return {
      address: address >>> 0,
      read: () => {
        const value = this.readSize(address, size);
        adjust();
        return value;
      },
      write: (value) => {
        this.writeSize(address, size, value);
        adjust();
      },
    };
  }

  effectiveAddress(mode, register, size, { immediate = false, writable = false } = {}) {
    if (mode === 0) {
      return {
        read: () => this.d[register] & maskForSize(size),
        write: (value) => this.writeDataRegister(register, size, value),
      };
    }

    if (mode === 1) {
      if (size === SIZE_BYTE || writable) throw new IllegalEffectiveAddress();
      return { read: () => this.a[register] & maskForSize(size) };
    }

    let address;
    if (mode === 2) {
      address = this.a[register];
    } else if (mode === 3) {
      address = this.a[register];
      return this.memoryOperand(address, size, register);
    } else if (mode === 4) {
      const decrement = size === SIZE_BYTE && register === 7 ? 2 : size;
      this.a[register] = (this.a[register] - decrement) >>> 0;
      address = this.a[register];
    } else if (mode === 5) {
      address = (this.a[register] + signExtend16(this.fetch16())) >>> 0;
    } else if (mode === 6) {
      const extension = this.fetch16();
      address = (
        this.a[register] + this.indexValue(extension) + signExtend8(extension & 0xff)
      ) >>> 0;
    } else if (mode === 7 && register === 0) {
      address = signExtend16(this.fetch16()) >>> 0;
    } else if (mode === 7 && register === 1) {
      address = this.readImmediate(SIZE_LONG);
    } else if (mode === 7 && register === 2 && !writable) {
      const base = this.pc;
      address = (base + signExtend16(this.fetch16())) >>> 0;
    } else if (mode === 7 && register === 3 && !writable) {
      const base = this.pc;
      const extension = this.fetch16();
      address = (base + this.indexValue(extension) + signExtend8(extension & 0xff)) >>> 0;
    } else if (mode === 7 && register === 4 && immediate && !writable) {
      const value = this.readImmediate(size);
      return { read: () => value };
    } else {
      throw new IllegalEffectiveAddress();
    }

    return this.memoryOperand(address, size);
  }

  controlAddress(mode, register) {
    if (mode === 2) return this.a[register];
    if (mode === 5) return (this.a[register] + signExtend16(this.fetch16())) >>> 0;
    if (mode === 6) {
      const extension = this.fetch16();
      return (this.a[register] + this.indexValue(extension) + signExtend8(extension & 0xff)) >>> 0;
    }
    if (mode === 7 && register === 0) return signExtend16(this.fetch16()) >>> 0;
    if (mode === 7 && register === 1) return this.readImmediate(SIZE_LONG);
    if (mode === 7 && register === 2) {
      const base = this.pc;
      return (base + signExtend16(this.fetch16())) >>> 0;
    }
    if (mode === 7 && register === 3) {
      const base = this.pc;
      const extension = this.fetch16();
      return (base + this.indexValue(extension) + signExtend8(extension & 0xff)) >>> 0;
    }
    throw new IllegalEffectiveAddress();
  }

  readImmediate(size) {
    if (size === SIZE_BYTE) return this.fetch16() & 0xff;
    if (size === SIZE_WORD) return this.fetch16();
    const high = this.fetch16();
    return (high * 0x1_0000 + this.fetch16()) >>> 0;
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

  setLogicalFlags(value, size) {
    const result = value & maskForSize(size);
    this.sr &= ~(SR_NEGATIVE | SR_ZERO | SR_OVERFLOW | SR_CARRY);
    if (result === 0) this.sr |= SR_ZERO;
    if (result & signBitForSize(size)) this.sr |= SR_NEGATIVE;
  }

  setAddFlags(source, destination, result, size) {
    const mask = maskForSize(size);
    const sign = signBitForSize(size);
    const src = source & mask;
    const dst = destination & mask;
    const res = result & mask;
    const carry = src + dst > mask;
    const overflow = Boolean((~(dst ^ src) & (dst ^ res) & sign) >>> 0);

    this.sr &= ~(SR_EXTEND | SR_NEGATIVE | SR_ZERO | SR_OVERFLOW | SR_CARRY);
    if (res === 0) this.sr |= SR_ZERO;
    if (res & sign) this.sr |= SR_NEGATIVE;
    if (overflow) this.sr |= SR_OVERFLOW;
    if (carry) this.sr |= SR_CARRY | SR_EXTEND;
  }

  setSubFlags(source, destination, result, size, affectExtend) {
    const mask = maskForSize(size);
    const sign = signBitForSize(size);
    const src = source & mask;
    const dst = destination & mask;
    const res = result & mask;
    const carry = src > dst;
    const overflow = Boolean(((dst ^ src) & (dst ^ res) & sign) >>> 0);
    const preservedExtend = this.sr & SR_EXTEND;

    this.sr &= ~(SR_EXTEND | SR_NEGATIVE | SR_ZERO | SR_OVERFLOW | SR_CARRY);
    if (!affectExtend) this.sr |= preservedExtend;
    if (res === 0) this.sr |= SR_ZERO;
    if (res & sign) this.sr |= SR_NEGATIVE;
    if (overflow) this.sr |= SR_OVERFLOW;
    if (carry) {
      this.sr |= SR_CARRY;
      if (affectExtend) this.sr |= SR_EXTEND;
    }
  }

  executeMove(opcode) {
    const size = opcode >>> 12 === 1
      ? SIZE_BYTE
      : opcode >>> 12 === 2
        ? SIZE_LONG
        : SIZE_WORD;
    const sourceMode = (opcode >>> 3) & 0x07;
    const sourceRegister = opcode & 0x07;
    const destinationMode = (opcode >>> 6) & 0x07;
    const destinationRegister = (opcode >>> 9) & 0x07;
    const validSource = sourceMode <= 6 || (sourceMode === 7 && sourceRegister <= 4);
    const validDestination = destinationMode === 0
      || (destinationMode >= 2 && destinationMode <= 6)
      || (destinationMode === 7 && destinationRegister <= 1)
      || (destinationMode === 1 && size !== SIZE_BYTE);
    if (!validSource || !validDestination || (sourceMode === 1 && size === SIZE_BYTE)) {
      throw new IllegalEffectiveAddress();
    }
    const source = this.effectiveAddress(sourceMode, sourceRegister, size, { immediate: true });
    const value = source.read();

    if (destinationMode === 1) {
      if (size === SIZE_BYTE) throw new IllegalEffectiveAddress();
      this.a[destinationRegister] = signExtend(value, size) >>> 0;
      return;
    }

    const destination = this.effectiveAddress(
      destinationMode,
      destinationRegister,
      size,
      { writable: true },
    );
    destination.write(value);
    this.setLogicalFlags(value, size);
  }

  executeLea(opcode) {
    const destinationRegister = (opcode >>> 9) & 0x07;
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;
    this.a[destinationRegister] = this.controlAddress(mode, register) >>> 0;
  }

  executeClr(opcode) {
    const size = sizeFromCode((opcode >>> 6) & 0x03);
    if (size === null) throw new IllegalEffectiveAddress();
    const destination = this.effectiveAddress(
      (opcode >>> 3) & 0x07,
      opcode & 0x07,
      size,
      { writable: true },
    );
    destination.write(0);
    this.setLogicalFlags(0, size);
  }

  executeTst(opcode) {
    const size = sizeFromCode((opcode >>> 6) & 0x03);
    if (size === null) throw new IllegalEffectiveAddress();
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;
    if (mode === 1 || (mode === 7 && register >= 2)) throw new IllegalEffectiveAddress();
    const source = this.effectiveAddress(mode, register, size);
    this.setLogicalFlags(source.read(), size);
  }

  executeJump(opcode, subroutine) {
    const target = this.controlAddress((opcode >>> 3) & 0x07, opcode & 0x07);
    if (subroutine) this.push32(this.pc);
    this.pc = target >>> 0;
  }

  executePea(opcode) {
    const address = this.controlAddress((opcode >>> 3) & 0x07, opcode & 0x07);
    this.push32(address);
  }

  executeLink(register) {
    const displacement = signExtend16(this.fetch16());
    const oldFramePointer = this.a[register];
    this.push32(oldFramePointer);
    this.a[register] = this.a[7];
    this.a[7] = (this.a[7] + displacement) >>> 0;
  }

  executeUnlk(register) {
    this.a[7] = this.a[register];
    this.a[register] = this.pop32();
  }

  executeRte(opcodeAddress) {
    if (!this.supervisor) {
      this.exception(M68K_VECTOR.PRIVILEGE_VIOLATION, opcodeAddress);
      return;
    }
    const restoredSr = this.pop16();
    const restoredPc = this.pop32();
    this.setStatusRegister(restoredSr);
    this.pc = restoredPc;
  }

  executeRtr() {
    const restoredCcr = this.pop16() & 0x1f;
    const restoredPc = this.pop32();
    this.sr = (this.sr & ~0x1f) | restoredCcr;
    this.pc = restoredPc;
  }

  executeStop(opcodeAddress) {
    if (!this.supervisor) {
      this.exception(M68K_VECTOR.PRIVILEGE_VIOLATION, opcodeAddress);
      return;
    }
    this.setStatusRegister(this.fetch16());
    this.stopped = true;
  }

  executeReset(opcodeAddress) {
    if (!this.supervisor) {
      this.exception(M68K_VECTOR.PRIVILEGE_VIOLATION, opcodeAddress);
      return;
    }
    this.bus.resetDevices?.();
  }

  executeQuick(opcode) {
    const amount = (opcode >>> 9) & 0x07 || 8;
    const subtract = Boolean(opcode & 0x0100);
    const size = sizeFromCode((opcode >>> 6) & 0x03);
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;
    if (size === null) throw new IllegalEffectiveAddress(); // DBcc/Scc use this size code.

    if (mode === 1) {
      if (size === SIZE_BYTE) throw new IllegalEffectiveAddress();
      this.a[register] = subtract
        ? (this.a[register] - amount) >>> 0
        : (this.a[register] + amount) >>> 0;
      return;
    }

    const validDestination = mode === 0
      || (mode >= 2 && mode <= 6)
      || (mode === 7 && register <= 1);
    if (!validDestination) throw new IllegalEffectiveAddress();
    const destination = this.effectiveAddress(mode, register, size, { writable: true });
    const oldValue = destination.read();
    const result = subtract ? oldValue - amount : oldValue + amount;
    destination.write(result);
    if (subtract) this.setSubFlags(amount, oldValue, result, size, true);
    else this.setAddFlags(amount, oldValue, result, size);
  }

  executeBit(opcode, dynamic) {
    const operation = (opcode >>> 6) & 0x03;
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;
    if (mode === 1 || (mode === 7 && register >= (operation === 0 ? 4 : 2))) {
      throw new IllegalEffectiveAddress();
    }

    const bitNumber = dynamic
      ? this.d[(opcode >>> 9) & 0x07]
      : this.fetch16();
    const size = mode === 0 ? SIZE_LONG : SIZE_BYTE;
    const bit = bitNumber % (size * 8);
    const writable = operation !== 0;
    const operand = this.effectiveAddress(mode, register, size, {
      immediate: operation === 0,
      writable,
    });
    const oldValue = operand.read();
    const bitMask = 2 ** bit;

    this.sr &= ~SR_ZERO;
    if ((oldValue & bitMask) === 0) this.sr |= SR_ZERO;
    if (!writable) return;

    let result;
    if (operation === 1) result = oldValue ^ bitMask;
    else if (operation === 2) result = oldValue & ~bitMask;
    else result = oldValue | bitMask;
    operand.write(result);
  }

  shiftValue(value, size, type, left, count) {
    const mask = maskForSize(size);
    const sign = signBitForSize(size);
    let result = (value & mask) >>> 0;
    let carry = false;
    let extend = Boolean(this.sr & SR_EXTEND);
    let overflow = false;

    for (let index = 0; index < count; index += 1) {
      const previousSign = Boolean(result & sign);
      if (left) {
        carry = previousSign;
        const input = type === 2 ? Number(extend) : type === 3 ? Number(carry) : 0;
        result = ((result << 1) | input) & mask;
      } else {
        carry = Boolean(result & 1);
        let input = 0;
        if (type === 0 && previousSign) input = sign;
        else if (type === 2 && extend) input = sign;
        else if (type === 3 && carry) input = sign;
        result = ((result >>> 1) | input) & mask;
      }
      result >>>= 0;
      if (type === 0 && left && previousSign !== Boolean(result & sign)) overflow = true;
      if (type === 2) extend = carry;
    }

    const oldExtend = Boolean(this.sr & SR_EXTEND);
    this.sr &= ~(SR_NEGATIVE | SR_ZERO | SR_OVERFLOW | SR_CARRY);
    if (result === 0) this.sr |= SR_ZERO;
    if (result & sign) this.sr |= SR_NEGATIVE;
    if (overflow) this.sr |= SR_OVERFLOW;
    if ((count === 0 && type === 2) ? oldExtend : carry) this.sr |= SR_CARRY;
    if (count > 0 && type !== 3) {
      this.sr &= ~SR_EXTEND;
      if (type === 2 ? extend : carry) this.sr |= SR_EXTEND;
    }
    return result >>> 0;
  }

  executeShift(opcode) {
    const memoryForm = ((opcode >>> 6) & 0x03) === 0x03;
    if (memoryForm) {
      const operation = (opcode >>> 8) & 0x07;
      const type = operation >>> 1;
      const left = Boolean(operation & 1);
      const mode = (opcode >>> 3) & 0x07;
      const register = opcode & 0x07;
      if (mode < 2 || (mode === 7 && register > 1)) throw new IllegalEffectiveAddress();
      const destination = this.effectiveAddress(mode, register, SIZE_WORD, { writable: true });
      const result = this.shiftValue(destination.read(), SIZE_WORD, type, left, 1);
      destination.write(result);
      return;
    }

    const size = sizeFromCode((opcode >>> 6) & 0x03);
    if (size === null) throw new IllegalEffectiveAddress();
    const destinationRegister = opcode & 0x07;
    const fromRegister = Boolean(opcode & 0x0020);
    const countField = (opcode >>> 9) & 0x07;
    const count = fromRegister ? this.d[countField] & 0x3f : countField || 8;
    const type = (opcode >>> 3) & 0x03;
    const left = Boolean(opcode & 0x0100);
    const oldValue = this.d[destinationRegister] & maskForSize(size);
    const result = this.shiftValue(oldValue, size, type, left, count);
    this.writeDataRegister(destinationRegister, size, result);
    this.cycles += count * 2;
  }

  executeImmediateToStatus(opcode, opcodeAddress) {
    const operation = opcode & 0xff00;
    const toStatusRegister = (opcode & 0x00ff) === 0x7c;
    if (toStatusRegister && !this.supervisor) {
      this.exception(M68K_VECTOR.PRIVILEGE_VIOLATION, opcodeAddress);
      return;
    }

    const immediate = this.fetch16();
    if (toStatusRegister) {
      if (operation === 0x0000) this.setStatusRegister(this.sr | immediate);
      else if (operation === 0x0200) this.setStatusRegister(this.sr & immediate);
      else this.setStatusRegister(this.sr ^ immediate);
      return;
    }

    const ccr = this.sr & 0x1f;
    const operand = immediate & 0x1f;
    const result = operation === 0x0000
      ? ccr | operand
      : operation === 0x0200
        ? ccr & operand
        : ccr ^ operand;
    this.sr = (this.sr & ~0x1f) | result;
  }

  executeImmediate(opcode, opcodeAddress) {
    const operation = opcode & 0xff00;
    const lowByte = opcode & 0x00ff;
    const statusOperation = operation === 0x0000 || operation === 0x0200 || operation === 0x0a00;
    if (statusOperation && (lowByte === 0x3c || lowByte === 0x7c)) {
      this.executeImmediateToStatus(opcode, opcodeAddress);
      return;
    }

    const size = sizeFromCode((opcode >>> 6) & 0x03);
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;
    const validDestination = mode === 0
      || (mode >= 2 && mode <= 6)
      || (mode === 7 && register <= 1);
    if (size === null || !validDestination) throw new IllegalEffectiveAddress();

    const immediate = this.readImmediate(size);
    const destination = this.effectiveAddress(mode, register, size, { writable: true });
    const oldValue = destination.read();

    if (operation === 0x0c00) {
      this.setSubFlags(immediate, oldValue, oldValue - immediate, size, false);
      return;
    }

    let result;
    if (operation === 0x0000) result = oldValue | immediate;
    else if (operation === 0x0200) result = oldValue & immediate;
    else if (operation === 0x0400) result = oldValue - immediate;
    else if (operation === 0x0600) result = oldValue + immediate;
    else if (operation === 0x0a00) result = oldValue ^ immediate;
    else throw new IllegalEffectiveAddress();

    destination.write(result);
    if (operation === 0x0400) this.setSubFlags(immediate, oldValue, result, size, true);
    else if (operation === 0x0600) this.setAddFlags(immediate, oldValue, result, size);
    else this.setLogicalFlags(result, size);
  }

  executeLogical(opcode, operation) {
    const dataRegister = (opcode >>> 9) & 0x07;
    const operationMode = (opcode >>> 6) & 0x07;
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;
    if (operationMode === 3 || operationMode === 7) throw new IllegalEffectiveAddress();
    const size = sizeFromCode(operationMode & 0x03);
    if (size === null) throw new IllegalEffectiveAddress();

    if (operationMode <= 2) {
      const source = this.effectiveAddress(mode, register, size, { immediate: true }).read();
      const oldValue = this.d[dataRegister] & maskForSize(size);
      const result = operation === "or" ? oldValue | source : oldValue & source;
      this.writeDataRegister(dataRegister, size, result);
      this.setLogicalFlags(result, size);
      return;
    }

    if (mode < 2) throw new IllegalEffectiveAddress(); // SBCD/ABCD/EXG encodings.
    const destination = this.effectiveAddress(mode, register, size, { writable: true });
    const oldValue = destination.read();
    const source = this.d[dataRegister] & maskForSize(size);
    const result = operation === "or" ? oldValue | source : oldValue & source;
    destination.write(result);
    this.setLogicalFlags(result, size);
  }

  executeAddSub(opcode, subtract) {
    const dataRegister = (opcode >>> 9) & 0x07;
    const operationMode = (opcode >>> 6) & 0x07;
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;

    if (operationMode === 3 || operationMode === 7) {
      const size = operationMode === 3 ? SIZE_WORD : SIZE_LONG;
      const source = this.effectiveAddress(mode, register, size, { immediate: true }).read();
      const operand = size === SIZE_WORD ? signExtend16(source) : source;
      this.a[dataRegister] = subtract
        ? (this.a[dataRegister] - operand) >>> 0
        : (this.a[dataRegister] + operand) >>> 0;
      return;
    }

    const sizeCode = operationMode & 0x03;
    const size = sizeFromCode(sizeCode);
    if (size === null) throw new IllegalEffectiveAddress();

    if (operationMode <= 2) {
      const source = this.effectiveAddress(mode, register, size, { immediate: true }).read();
      const destination = this.d[dataRegister] & maskForSize(size);
      const result = subtract ? destination - source : destination + source;
      this.writeDataRegister(dataRegister, size, result);
      if (subtract) this.setSubFlags(source, destination, result, size, true);
      else this.setAddFlags(source, destination, result, size);
      return;
    }

    if (mode < 2) throw new IllegalEffectiveAddress(); // ADDX/SUBX encodings.
    const destination = this.effectiveAddress(mode, register, size, { writable: true });
    const oldValue = destination.read();
    const source = this.d[dataRegister] & maskForSize(size);
    const result = subtract ? oldValue - source : oldValue + source;
    destination.write(result);
    if (subtract) this.setSubFlags(source, oldValue, result, size, true);
    else this.setAddFlags(source, oldValue, result, size);
  }

  executeCmp(opcode) {
    const dataRegister = (opcode >>> 9) & 0x07;
    const operationMode = (opcode >>> 6) & 0x07;
    const mode = (opcode >>> 3) & 0x07;
    const register = opcode & 0x07;

    if (operationMode === 3 || operationMode === 7) {
      const size = operationMode === 3 ? SIZE_WORD : SIZE_LONG;
      const source = this.effectiveAddress(mode, register, size, { immediate: true }).read();
      const operand = size === SIZE_WORD ? signExtend16(source) : source;
      const destination = this.a[dataRegister];
      this.setSubFlags(operand, destination, destination - operand, SIZE_LONG, false);
      return;
    }

    if (operationMode >= 4 && operationMode <= 6) {
      if (mode === 1) throw new IllegalEffectiveAddress(); // CMPM encoding.
      const size = sizeFromCode(operationMode - 4);
      const destination = this.effectiveAddress(mode, register, size, { writable: true });
      const oldValue = destination.read();
      const result = oldValue ^ (this.d[dataRegister] & maskForSize(size));
      destination.write(result);
      this.setLogicalFlags(result, size);
      return;
    }

    if (operationMode > 2) throw new IllegalEffectiveAddress();
    const size = sizeFromCode(operationMode);
    const source = this.effectiveAddress(mode, register, size, { immediate: true }).read();
    const destination = this.d[dataRegister] & maskForSize(size);
    this.setSubFlags(source, destination, destination - source, size, false);
  }

  step() {
    if (this.stopped) return 0;
    const initialCycles = this.cycles;
    const opcodeAddress = this.pc;
    const opcode = this.fetch16();

    try {
      if (opcode === 0x4e70) {
        this.executeReset(opcodeAddress);
      } else if (opcode === 0x4e71) {
        // NOP: on the MC68008 the 16-bit opcode fetch itself takes eight clocks.
      } else if (opcode === 0x4e72) {
        this.executeStop(opcodeAddress);
      } else if (opcode === 0x4e73) {
        this.executeRte(opcodeAddress);
      } else if (opcode === 0x4e75) {
        this.pc = this.pop32();
      } else if (opcode === 0x4e77) {
        this.executeRtr();
      } else if ((opcode & 0xf000) === 0x6000) {
        this.executeBranch(opcode);
      } else if ((opcode & 0xf000) === 0x5000) {
        this.executeQuick(opcode);
      } else if ((opcode & 0xf100) === 0x7000) {
        this.executeMoveQ(opcode);
      } else if (opcode >>> 12 >= 1 && opcode >>> 12 <= 3) {
        this.executeMove(opcode);
      } else if ((opcode & 0xffc0) === 0x4e80) {
        this.executeJump(opcode, true);
      } else if ((opcode & 0xffc0) === 0x4ec0) {
        this.executeJump(opcode, false);
      } else if ((opcode & 0xffc0) === 0x4840) {
        this.executePea(opcode);
      } else if ((opcode & 0xfff8) === 0x4e50) {
        this.executeLink(opcode & 0x07);
      } else if ((opcode & 0xfff8) === 0x4e58) {
        this.executeUnlk(opcode & 0x07);
      } else if ((opcode & 0xf1c0) === 0x41c0) {
        this.executeLea(opcode);
      } else if ((opcode & 0xff00) === 0x4200) {
        this.executeClr(opcode);
      } else if ((opcode & 0xff00) === 0x4a00) {
        this.executeTst(opcode);
      } else if ((opcode & 0xf000) === 0xd000) {
        this.executeAddSub(opcode, false);
      } else if ((opcode & 0xf000) === 0x9000) {
        this.executeAddSub(opcode, true);
      } else if ((opcode & 0xf000) === 0xb000) {
        this.executeCmp(opcode);
      } else if ((opcode & 0xf000) === 0x8000) {
        this.executeLogical(opcode, "or");
      } else if ((opcode & 0xf000) === 0xc000) {
        this.executeLogical(opcode, "and");
      } else if ((opcode & 0xf100) === 0x0100) {
        this.executeBit(opcode, true);
      } else if ((opcode & 0xff00) === 0x0800) {
        this.executeBit(opcode, false);
      } else if ((opcode & 0xf000) === 0xe000) {
        this.executeShift(opcode);
      } else if ([0x0000, 0x0200, 0x0400, 0x0600, 0x0a00, 0x0c00].includes(opcode & 0xff00)) {
        this.executeImmediate(opcode, opcodeAddress);
      } else {
        throw new IllegalEffectiveAddress();
      }
    } catch (error) {
      if (!(error instanceof IllegalEffectiveAddress)) throw error;
      this.exception(M68K_VECTOR.ILLEGAL_INSTRUCTION, opcodeAddress);
    }

    return this.cycles - initialCycles;
  }

  externalAddress(address) {
    return address & ADDRESS_MASK;
  }
}
