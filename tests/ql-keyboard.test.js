import assert from "node:assert/strict";
import test from "node:test";
import { qlKeyDefinition, QL_KEYBOARD } from "../src/ui/ql-keyboard.js";

test("mapeia letras, funções e cursores para a matriz física do QL", () => {
  assert.equal(QL_KEYBOARD.keyrowByCode.KeyA, 28);
  assert.equal(QL_KEYBOARD.keyrowByCode.F1, 57);
  assert.equal(QL_KEYBOARD.keyrowByCode.ArrowLeft, 49);
  assert.deepEqual(qlKeyDefinition({ code: "F2" }), {
    keyrow: 59,
    shift: false,
    control: false,
    alt: false,
  });
});

test("conserva modificadores e ignora teclas alheias à matriz", () => {
  assert.deepEqual(qlKeyDefinition({
    code: "KeyP",
    shiftKey: true,
    ctrlKey: true,
    altKey: true,
    metaKey: false,
  }), { keyrow: 29, shift: true, control: true, alt: true });
  assert.equal(qlKeyDefinition({ code: "F12" }), null);
  assert.equal(qlKeyDefinition({ code: "KeyA", metaKey: true }), null);
});

test("traduz Backspace no equivalente Ctrl+seta esquerda do QL", () => {
  assert.deepEqual(qlKeyDefinition({ code: "Backspace" }), {
    keyrow: QL_KEYBOARD.keyrowByCode.ArrowLeft,
    shift: false,
    control: true,
    alt: false,
  });
});
