# Robô de Ofertas: guia de instalação

O robô busca ofertas na Shopee pela API oficial de afiliados e posta nos seus grupos de WhatsApp com o seu link. Links do Mercado Livre e da Amazon você posta pelo painel, na aba **Postar link**.

Custo: só o servidor, uns R$ 30 a 50 por mês.

---

## 1. Chaves da Shopee (5 minutos)
1. Entre em **affiliate.shopee.com.br** com a sua conta de afiliado.
2. Abra o menu **Open API**. Se ele não aparecer, peça o acesso por ali mesmo. A Shopee analisa o pedido.
3. Anote o **App ID** (só números) e a **Secret**. Você vai colar os dois no painel depois.

## 2. Contratar o servidor (10 minutos)
- Contrate uma **VPS** com pelo menos **2 GB de RAM**. Hostinger (KVM 1 ou maior), Contabo, Magalu Cloud e similares servem.
- Sistema: **Ubuntu 24.04**.
- Se der para escolher, prefira o datacenter no **Brasil**.
- Defina uma senha de root e anote.

## 3. Código no GitHub
Já está em github.com/mikaellsuka25/robo-ofertas. Pule este passo.

<!-- passo antigo -->
## (antigo) Colocar o código no GitHub
1. Crie uma conta grátis em **github.com**.
2. Toque em **New repository**, use o nome `robo-ofertas` e marque **Public**. O código não tem nenhuma senha sua.
3. No computador, descompacte o `robo-ofertas.zip`.
4. Clique em **uploading an existing file** e arraste **o conteúdo** da pasta `robo-ofertas`. Depois clique em **Commit changes**.

> Alternativa: conecte o GitHub ao Claude (claude.ai → Configurações → Conectores) e peça para o Claude enviar o código para você.

## 4. Instalar (1 comando)
1. No painel da VPS, abra o **Terminal** (no navegador mesmo; na Hostinger fica em "Terminal do navegador").
2. Cole o comando abaixo e aperte Enter:

```
curl -fsSL https://raw.githubusercontent.com/mikaellsuka25/robo-ofertas/main/instalar.sh | bash -s https://github.com/mikaellsuka25/robo-ofertas
```

3. Espere uns 5 minutos. No fim aparece:
   - o endereço do painel, por exemplo `http://123.45.67.89`
   - a **senha do painel** (anote!)

## 5. Configurar pelo painel (no celular mesmo)
1. Abra o endereço e entre com a senha.
2. **Configurações** → cole o App ID e a Secret → **Salvar e testar conexão**.
3. **WhatsApp** → escaneie o QR code com o celular do **número do robô** (Dispositivos conectados → Conectar dispositivo).
   - Se o painel estiver aberto no mesmo celular, use o **código de 8 letras**.
4. **Grupos** → marque os grupos → **Salvar**.
5. **Início** → **Buscar ofertas agora**. Em 1 ou 2 minutos a **Fila** enche.

Pronto. A partir daqui ele posta sozinho, no ritmo das Configurações. O padrão é 1 oferta a cada ~10 minutos, das 8h às 23h, no máximo 90 por dia.

---

## Transição segura a partir da Promium
- Rode por **1 ou 2 semanas** com o robô postando só num **grupo de teste**.
- Não conecte o mesmo número na Promium e no robô ao mesmo tempo **postando nos mesmos grupos**: isso duplica as mensagens e aumenta o risco de bloqueio.
- Quando estiver tudo certo: desligue a Promium, escolha os grupos de verdade e cancele a assinatura.

## Dicas para não perder o número
- Mantenha 2 números reserva como **administradores** dos grupos.
- Se as pessoas começarem a sair mais, aumente o intervalo entre as ofertas.
- Na descrição do grupo: "Não curtiu? É só sair, sem denunciar 🙏".

## Problemas comuns
| O que aparece | O que fazer |
|---|---|
| "A Shopee recusou" | Confira o App ID e a Secret, sem espaços. Veja se o Open API está liberado na sua conta. |
| WhatsApp desconectou | Aba WhatsApp → escaneie de novo. |
| Fila vazia | Diminua o "Desconto mínimo" ou as "Vendas mínimas", ou acrescente palavras-chave. |
| Painel não abre | No terminal da VPS: `cd /opt/robo-ofertas && docker compose up -d` |

## Atualizar o robô no futuro
No terminal da VPS, rode o mesmo comando do passo 4. Suas configurações são mantidas.
