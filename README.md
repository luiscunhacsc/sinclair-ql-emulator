# Sinclair QL Emulator

Emulador do Sinclair QL para o navegador, escrito em JavaScript e sem
dependências de execução.

## Objetivo

A primeira configuração-alvo é um Sinclair QL Issue 6:

- MC68008 a 7,5 MHz;
- 128 KiB de RAM;
- ROM interna de 48 KiB, incluindo a Minerva livre distribuída pelo projeto;
- ZX8301 e os dois modos de vídeo originais;
- ZX8302, Intel 8049/IPC, teclado, joysticks, som e RTC;
- dois Microdrives com imagens `.mdv`;
- temporização suficientemente rigorosa para executar software original.

O projeto inclui a versão inglesa da **Minerva 1.98a1**, distribuída nos termos
da GPL-2.0-or-later, juntamente com uma cópia completa e imutável do respetivo
código-fonte. As ROMs QDOS/Sinclair não livres continuam deliberadamente
excluídas. Consulte [ROMs e licenças](roms/README.md) e os
[avisos de terceiros](THIRD_PARTY_NOTICES.md).

## Executar

Requer Node.js 20 ou posterior apenas para o servidor local e para os testes.

```sh
npm start
```

Abrir `http://localhost:8080`.

A Minerva incluída é carregada automaticamente. Os controlos permitem executar,
pausar, avançar uma instrução ou reiniciar a máquina; o seletor **Outra ROM**
continua disponível para testes locais. A ROM é processada apenas no navegador.

## Testes

```sh
npm test
```

O comando também confirma o tamanho e os hashes da ROM, do código-fonte
correspondente e dos avisos exigidos pela licença.

## Licença

O código do emulador é Copyright (C) 2026 Luís Simões da Cunha e está licenciado
sob a [GNU GPL versão 2 apenas](LICENSE). A Minerva é um componente independente
de Laurence Reeves, sob GPL versão 2 ou posterior; os seus termos, proveniência
e fontes correspondentes estão identificados em
[`third_party/minerva/`](third_party/minerva/).

## Estado

O projeto contém a estrutura do emulador, barramento de 20 bits, mapa inicial de
ROM/RAM, carregamento automático da Minerva e o primeiro bloco de vídeo do
ZX8301: `MC_STAT`, blanking, MODE 4/8, dois bancos de ecrã e conversão para um
canvas RGBA de 512 × 256. Um primeiro bloco do ZX8302 fornece os registos e o
handshake IPC inativo necessários para a Minerva começar a desenhar. O primeiro bloco do MC68008 já implementa
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
