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
continua disponível para testes locais. Clique no ecrã para enviar o teclado do
navegador ao QL. Para facilitar a utilização com teclados modernos, Backspace é
traduzido automaticamente no atalho Ctrl+seta esquerda do QL; Ctrl+seta direita
apaga o carácter sob o cursor. A ROM é processada apenas no navegador.

### Carregar software

O controlo **Software / Microdrive 1** aceita, apenas para leitura:

- imagens `.mdv` no formato QLAY de 174 930 bytes;
- pacotes `.qlpak` do Q-emuLator;
- arquivos `.zip`, incluindo o campo adicional que preserva o tipo e o espaço
  de dados dos executáveis QDOS.

QLPAK e ZIP são descomprimidos localmente e convertidos numa imagem Microdrive
temporária. Nos pacotes configurados como `FLP1`, as referências do ficheiro
`BOOT` são adaptadas para `MDV1`, sem alterar os restantes ficheiros. Pacotes
que ultrapassem a capacidade de um cartucho são recusados claramente; formatos
destinados a discos `WIN` e software que exija hardware ainda não emulado não
são suportados por esta conversão.

A máquina reinicia quando o suporte é montado; prima F1 ou F2 no ecrã inicial
para o QL procurar `mdv1_boot`. **Ejetar MDV1** remove o cartucho sem alterar o
ficheiro original. Todo o conteúdo permanece no navegador.

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
canvas RGBA de 512 × 256. O ZX8302 fornece os registos, a comunicação IPC
bit-serial, o teclado e a interrupção periódica necessários para a Minerva
chegar ao ecrã interativo do SuperBASIC. O primeiro Microdrive aceita imagens
QLAY `.mdv` apenas para leitura, incluindo seleção em cadeia, GAP, cabeçalhos e
registos de setor através dos registos do ZX8302. Pacotes QLPAK e ZIP que caibam
num cartucho são convertidos localmente para este formato, preservando os
metadados QDOS conhecidos. O primeiro bloco do MC68008 já
implementa reset, registos, pilhas de supervisor/utilizador, acesso alinhado, exceção de
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
