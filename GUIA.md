# Robô de Ofertas: guia

O robô transforma ofertas da Shopee em promoções prontas, com o seu link de afiliado, e envia para os seus grupos de WhatsApp e Telegram. Ele faz o mesmo que a Promium faz para a Shopee, rodando no seu computador ou num servidor seu.

---

## Ligar no computador (Windows)
1. Abra o **Docker Desktop** e espere aparecer **Engine running**.
2. Baixe o robô: https://github.com/mikaellsuka25/robo-ofertas/archive/refs/heads/main.zip
3. Extraia e dê dois cliques em **iniciar-windows.bat**.
4. O painel abre em **http://localhost**. A senha aparece na janela preta e não muda quando você atualiza.

Para desligar, use **parar-windows.bat**. Para atualizar, repita os passos 2 e 3: suas configurações, grupos e filas continuam salvos.

## Ligar num servidor (VPS, 24 horas por dia)
Contrate uma VPS com Ubuntu 24.04 e 2 GB de RAM. No terminal dela, cole:

```
curl -fsSL https://raw.githubusercontent.com/mikaellsuka25/robo-ofertas/main/instalar.sh | bash -s https://github.com/mikaellsuka25/robo-ofertas
```

No fim aparecem o endereço e a senha do painel. O mesmo comando atualiza o robô depois.

---

## Primeiros passos no painel
1. **Credenciais:** cole o App ID e a Secret da Shopee (affiliate.shopee.com.br → Open API) e toque em **Salvar e testar**.
2. **Números (WhatsApp):** conecte o número pelo QR code. Dá para adicionar números reserva.
3. **Grupos e categorias:** toque em **Buscar grupos**, marque os grupos que vão **receber** ofertas e, se quiser, coloque categorias (ex.: "Casa").
4. **Minhas automações:** crie uma automação e ative.

A tela **Início** mostra uma lista do que falta configurar.

---

## O que tem em cada tela

| Tela | Para que serve |
|---|---|
| Início | Enviadas hoje, fila, falhas, status dos números e botão para pausar tudo |
| Feed de produtos | Todo produto que passou pelo robô. Dá para editar, favoritar, enviar ou pôr numa fila. Também gera promoção a partir de um link colado |
| Números (WhatsApp) | Conectar, renomear, desconectar e adicionar números |
| Grupos e categorias | Cadastrar os grupos de destino e juntar em categorias |
| Modo de envio | Como os números são usados (escolher na automação, alternada ou dividida) e marca d'água nas fotos |
| Telegram | Ligar o seu bot e vincular grupos/canais com `/link CÓDIGO` |
| Envio direto | Até 20 links de uma vez: enviar agora ou pôr na fila de uma automação |
| Envio manual | Mensagem livre, com foto ou prévia do link, agora ou agendada (até 90 dias) |
| Histórico | Tudo que foi enviado e as falhas, com o motivo |
| Minhas automações | Criar, editar, pausar e ver a fila de cada automação |
| Textos e chamadas | Seus modelos de mensagem com variáveis, a frase do cupom e o estilo da chamada |
| Cupons | Seus cupons; o robô escolhe o de maior desconto que vale para o preço |
| Tags de preço e cupom | Como usar #preco, #cupom etc. e um simulador |
| Vitrine | Página pública com as ofertas enviadas e contagem de cliques |
| Gerador de links | Página pública onde seguidores convertem links da Shopee com o seu afiliado |
| Rotador de grupos | Um link de convite que manda as pessoas para o grupo com vaga |
| Credenciais | Shopee, IA para chamadas (opcional) e endereço público |

## Os 5 tipos de automação

| Tipo | De onde vêm os links | O que sai |
|---|---|---|
| Busca de produtos | O robô procura na Shopee pelas suas palavras-chave e filtros | Promoção nova a cada intervalo, variando o tipo de produto |
| Automatizador / Fila de promoções | Links que você cola num grupo seu (com tags), no Feed, no Envio direto ou numa planilha | Promoção nova com o seu texto |
| Monitoramento | Grupos de outros afiliados (até 3) | Promoção nova com o seu texto e o seu link |
| Monitoramento Clone | Grupos de outros afiliados (até 3) | A mensagem inteira copiada, só com os links trocados |
| Replicador | Um grupo seu | A mensagem como chegou |

Todas têm: grupos ou categorias de destino, envio imediato ou em fila com intervalo, horário de funcionamento, máximo por dia, prévia do link ou imagem com legenda e filtros (bloquear palavras, exigir palavras, faixa de preço, desconto mínimo e substituições).

## Variáveis dos textos
`{nome}` `{preco_original}` `{preco_atual}` `{desconto}` `{link}` `{link_site}` `{loja}` `{cta}` `{cta_ia}` `{cta_ia_m}` `{cupom_codigo}` `{cupom_link}` `{cupom_texto}` `{preco_com_cupom}` `{economia_cupom}` `{nota}` `{vendas}` `{comissao}` `{texto}`

Se uma variável estiver vazia, a linha some. Trechos entre colchetes, como `[De ~R$ {preco_original}~ |]`, somem sozinhos.

## Tags no grupo de origem
```
https://s.shopee.com.br/xxxx
#preco 39,90
#precoa 79,90
#cupom ACHADO10
#desconto 10%
#limite 30
#texto Só até meia-noite!
```

---

## O que ainda não tem
- Lojas além da Shopee (Mercado Livre, Amazon e outras).
- Cupons oficiais das lojas buscados sozinhos.
- Extensão do navegador.
- Vários afiliados Shopee numa conta.

## Dicas para não perder o número
- Mantenha 2 números reserva como **administradores** dos grupos e conectados em **Números**. Se um cair, outro assume.
- Se as pessoas começarem a sair mais, aumente o intervalo entre as ofertas.
- Na descrição do grupo: "Não curtiu? É só sair, sem denunciar 🙏".

## Problemas comuns
| O que aparece | O que fazer |
|---|---|
| "A Shopee recusou" | Confira o App ID e a Secret em Credenciais |
| Número desconectado | Números → Conectar → escaneie de novo |
| Promoção não saiu | Histórico → Falhas mostra o motivo |
| Monitoramento não pega nada | O número precisa estar no grupo monitorado, e a automação precisa estar ativa e no horário |
| Fila vazia na Busca | Diminua o desconto mínimo ou as vendas mínimas, ou acrescente palavras-chave |
| Painel não abre | Rode o iniciar-windows.bat de novo (ou, na VPS, o comando de instalação) |
