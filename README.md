# Sinclair QL Emulator

Emulador do Sinclair QL para o navegador, escrito em JavaScript e sem
dependências de execução.

## Objetivo

A primeira configuração-alvo é um Sinclair QL Issue 6:

- MC68008 a 7,5 MHz;
- 128 KiB de RAM;
- ROM de 48 KiB fornecida pelo utilizador;
- ZX8301 e os dois modos de vídeo originais;
- ZX8302, Intel 8049/IPC, teclado, joysticks, som e RTC;
- dois Microdrives com imagens `.mdv`;
- temporização suficientemente rigorosa para executar software original.

O emulador não inclui ROMs protegidas por direitos de autor. O utilizador pode
carregar uma imagem obtida legitimamente do seu QL ou usar uma ROM alternativa
com licença compatível, como a Minerva.

## Executar

Requer Node.js 20 ou posterior apenas para o servidor local e para os testes.

```sh
npm start
```

Abrir `http://localhost:8080`.

## Testes

```sh
npm test
```

## Estado

O projeto contém a estrutura do emulador, barramento de 20 bits, mapa inicial de
ROM/RAM e carregamento local da ROM. O primeiro bloco do MC68008 já implementa
reset, registos, pilhas de supervisor/utilizador, acesso alinhado, exceção de
instrução ilegal, emulação das linhas A/F, trace, interrupções autovetorizadas,
violação de privilégio e códigos de condição. Estão
implementados NOP, MOVEQ, MOVE/MOVEA, LEA, CLR, TST, NEG/NEGX, NOT, EXT, SWAP,
TAS, transferências de SR/CCR/USP, ADD/ADDA, SUB/SUBA, CMP/CMPA, ADDQ/SUBQ,
ADDX/SUBX, ABCD/SBCD/NBCD, CMPM, MOVEM, MOVEP, MULU/MULS, DIVU/DIVS, CHK, OR,
AND, EOR, EXG, operações de bits, shifts e rotações, as variantes imediatas,
BRA/Bcc, BSR, DBcc, Scc, JMP, JSR, PEA, LINK/UNLK, TRAP/TRAPV, RESET, STOP, RTS,
RTR e RTE, bem como os principais modos de endereçamento do MC68000. A cobertura
da CPU será aumentada incrementalmente e confrontada com os testes públicos
SingleStepTests/m68000.
