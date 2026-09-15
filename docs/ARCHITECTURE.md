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

O ZX8302 descodifica os registos de controlo/transmissão (`0x18002`/`0x18003`)
e leitura/interrupt (`0x18020`/`0x18021`). A ligação ao IPC interpreta comandos
e respostas bit a bit, incluindo estado e leitura do buffer do teclado. Os
comandos de som e série ainda não implementados consomem os respetivos
parâmetros e devolvem um estado inativo, mantendo o fluxo sincronizado.

A interface converte `KeyboardEvent.code` na matriz física inglesa do QL e
entrega até sete definições por comando `rdkb`. Shift, Control e Alt seguem no
nibble de modificadores usado pela rotina de tradução da Minerva.

O mesmo bloco acumula ciclos do processador e levanta `pc.intrf` a 50 Hz. O
barramento agrega o nível pedido pelos dispositivos e apresenta esta fonte ao
MC68008 como interrupção de nível 2; uma escrita de `pc.intrf` em `pc_intr`
reconhece e limpa a fonte.

Na configuração inicial sem cartucho, a linha GAP permanece alta. Ativar a
máscara `pc.maskg` levanta por isso `pc.intrg`; enquanto a máscara continuar
ativa, reconhecer a fonte volta a solicitá-la. Este comportamento permite ao
servidor de Microdrive da Minerva detetar a ausência de meio e terminar a
pesquisa por `boot`/`mdv1_boot`.

### Microdrive: leitura e escrita

`src/devices/microdrive.js` valida e encapsula imagens QLAY `.mdv`. Cada imagem
tem 255 setores de 686 bytes: preâmbulo e cabeçalho, preâmbulo e registo QDOS,
seguidos dos bytes físicos de enchimento. O ZX8302 expõe os 16 bytes de cabeçalho
e os 612 bytes do registo nos endereços de pista `0x18022`/`0x18023`, sinalizando
GAP e buffer de leitura em `0x18020`.

O mapa de registos e os sinais seguem o *QL Technical Guide*. A disposição da
imagem foi também confrontada com o formato publicado pelo
[QLAY2](https://github.com/xXorAa/qlay2) e pelo projeto MIT
[MicroPicoDrive](https://github.com/gusmanb/micropicodrive).

A escrita nos mesmos endereços reproduz `pc.erase` e `pc.write`, os preâmbulos,
os cabeçalhos e os registos físicos emitidos pela ROM. Cartuchos virgens usam
um percurso de 254 setores com uma pequena emenda interna não gravável: isto
permite à rotina `FORMAT` detetar a descontinuidade que espera numa fita real,
em vez de rejeitar um percurso artificialmente perfeito. Um teste de integração
arranca a Minerva, executa `FORMAT mdv1_test`, cria um programa com
`SAVE mdv1_demo` e volta a lê-lo com `LOAD` a partir da imagem exportada.

A seleção em cadeia suporta até oito unidades.
A biblioteca em `src/main.js` permite montar e ejetar cada unidade entre
`mdv1_` e `mdv8_`; os cartuchos são conservados durante RESET. A imagem é
copiada ao montar, pelo que o ficheiro escolhido pelo utilizador nunca é
modificado. Imagens importadas são protegidas contra escrita. Cartuchos virgens
ficam graváveis em memória, assinalam alterações pendentes e podem ser
descarregados como uma nova imagem `.mdv`; a persistência contínua e a fidelidade
de temporização ao nível das duas pistas ficam para marcos seguintes.

### Importação QLPAK/ZIP

`src/formats/zip.js` lê o subconjunto seguro do ZIP clássico utilizado pelos
arquivos QDOS: entradas armazenadas ou Deflate, sem encriptação, volumes
múltiplos ou ZIP64. Os tamanhos e CRC-32 são verificados antes da conversão e
existem limites contra arquivos de descompressão excessiva.

`src/formats/ql-package.js` reconhece a configuração `.QCF`, a pasta `PakDir1`,
o cabeçalho inline `]!QDOS File Header` e o campo ZIP QDOS `0xFB4A`. Os
metadados são transformados em cabeçalhos de diretório QDOS de 64 bytes. Quando
o pacote usa o nome de dispositivo `FLP`, apenas o ficheiro `BOOT` é adaptado de
`flp1_` para a unidade `mdv1_`–`mdv8_` escolhida.

`src/ui/software-library.js` concentra a identificação, ordenação e apresentação
dos ficheiros suportados. A interface mantém apenas referências aos objetos
`File` selecionados pelo utilizador e só lê os respetivos bytes no momento da
montagem. Escolher outra pasta substitui a lista; adicionar ficheiros ou
arrastá-los para o painel combina-os sem duplicar o mesmo caminho, tamanho e
data de alteração.

`src/formats/microdrive-builder.js` constrói em memória o diretório, mapa de
alocação, blocos de 512 bytes, preâmbulos e somas de verificação de uma imagem
QLAY. A conversão fica limitada à capacidade real do cartucho; pacotes maiores
necessitarão futuramente de um dispositivo de disco ou `WIN`.

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
