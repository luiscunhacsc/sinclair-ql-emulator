# Arquitetura do emulador

## Princípios

1. O comportamento documentado do hardware é a fonte principal.
2. MAME, sQLux e o núcleo MiSTer são usados para comparação, não copiados.
3. CPU, barramento e dispositivos não dependem da interface gráfica.
4. Cada instrução e dispositivo deve ter testes determinísticos.
5. A temporização é contabilizada em ciclos do relógio principal.

## Camadas

- `src/core`: MC68008, barramento, memória, interrupções e relógio.
- `src/devices`: ZX8301, ZX8302, IPC 8049, Microdrives e portas.
- `src/ui`: Canvas, teclado, áudio e controlos do navegador.
- `tests`: testes unitários, programas de diagnóstico e regressões.

## Mapa inicial

| Intervalo | Função |
| --- | --- |
| `0x00000–0x0BFFF` | ROM interna, 48 KiB |
| `0x0C000–0x0FFFF` | cartucho ROM, 16 KiB |
| `0x10000–0x17FFF` | ROM/expansões |
| `0x18000–0x1FFFF` | dispositivos e espaço reservado |
| `0x20000–0x3FFFF` | RAM interna, 128 KiB |
| `0x40000–0xFFFFF` | RAM e periféricos de expansão |

O descodificador de dispositivos será refinado à medida que ZX8301 e ZX8302
forem implementados. A CPU expõe 20 linhas de endereço, pelo que todos os
endereços são normalizados para 20 bits.

### Primeiro bloco do ZX8301

O barramento encaminha endereços mapeados para dispositivos independentes. O
ZX8301 implementa inicialmente o registo write-only `MC_STAT` (`0x18063`): bit
1 para blanking, bit 3 para MODE 8 e bit 7 para selecionar o banco de display
RAM em `0x20000` ou `0x28000`. Os 32 KiB do banco ativo são convertidos num
frame RGBA de 512 × 256, incluindo a duplicação horizontal do MODE 8 e o estado
de flash que reinicia em cada linha.

Esta implementação segue as secções 10.2 e 10.3 do documento original
[QL Technical Guide](https://8bit-wiki.de/Sinclair/QL/DOKUMENTATIONEN/QL%20Technical%20Guide.pdf),
publicado pela Sinclair Research Ltd.

### Primeiro bloco do ZX8302/IPC

O bloco inicial do ZX8302 descodifica os registos de controlo/transmissão
(`0x18002`/`0x18003`) e leitura/interrupt (`0x18020`/`0x18021`). O handshake
bit-serial confirma imediatamente cada bit, com o IPC ainda inativo e sem
teclas, som ou dados série. Isto permite à Minerva concluir a configuração
inicial do IPC e começar a desenhar na display RAM; a interpretação completa
dos comandos do 8049 permanece para o marco seguinte.

O mesmo bloco acumula ciclos do processador e levanta `pc.intrf` a 50 Hz. O
barramento agrega o nível pedido pelos dispositivos e apresenta esta fonte ao
MC68008 como interrupção de nível 2; uma escrita de `pc.intrf` em `pc_intr`
reconhece e limpa a fonte.

## Marcos

1. Barramento, ROM, RAM e testes de endianess.
2. MC68008: exceções, instruções, modos de endereçamento e ciclos.
3. Arranque da ROM até ao primeiro acesso ao hardware.
4. Vídeo e interrupção de frame.
5. IPC, teclado, som, portas e relógio.
6. Microdrives, imagens persistentes e estados guardados.
7. Suite de compatibilidade e afinação em hardware real.

## Validação do MC68008

O conjunto de instruções é implementado a partir dos manuais Motorola. Além dos
testes unitários pequenos e legíveis deste repositório, será usado o corpus
`SingleStepTests/m68000`, que contém estados completos antes e depois de cada
instrução. As diferenças de barramento entre MC68000 e MC68008 serão validadas
separadamente: no QL cada transferência de byte ocupa inicialmente quatro
clocks, e uma leitura de palavra exige duas transferências.

### Modos já implementados

- registo de dados e registo de endereço;
- indireto, pós-incremento e pré-decremento;
- deslocamento de 16 bits e índice breve de 8 bits;
- absoluto curto e longo;
- relativo ao PC, simples e indexado;
- imediato.

O tratamento funcional destes modos está separado da afinação final dos ciclos.
A contenção de memória introduzida pelo ZX8301 será acrescentada na camada do
barramento quando o vídeo estiver operacional.

Os deslocamentos de 16 bits de `BRA`, `Bcc` e `BSR` usam como base o endereço
da palavra de extensão, conforme o MC68000. O endereço de retorno de `BSR.W`
continua a ser o PC posterior à extensão; esta distinção é necessária para a
Minerva entrar corretamente em `SB_START/ini_disp`.
