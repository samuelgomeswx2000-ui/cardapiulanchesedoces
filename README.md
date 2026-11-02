# Cardápio Digital — Burguer Zone & Doce Terapia

Site responsivo com cardápio, busca e categorias, sacola, cadastro/login, avaliações, favoritos, histórico de pedidos e painel administrativo. As logos enviadas foram incluídas em `public/assets/`.

## Requisitos
- Node.js 20 ou superior
- npm

## Rodar localmente
1. Extraia o ZIP.
2. Abra um terminal na pasta do projeto.
3. Execute `npm install`.
4. Configure as variáveis de ambiente abaixo para criar o primeiro administrador.
5. Execute `npm start`.
6. Abra `http://localhost:3000`.

### Criar o primeiro administrador
Configure `ADMIN_EMAIL` e `ADMIN_PASSWORD` **antes de iniciar o servidor pela primeira vez**. Exemplo no PowerShell:

```powershell
$env:ADMIN_EMAIL="seu-email@exemplo.com"
$env:ADMIN_PASSWORD="uma-senha-forte-com-12-caracteres"
$env:SESSION_SECRET="uma-chave-aleatoria-grande"
npm start
```

Depois abra `/admin` e entre com essas credenciais. O cadastro público cria contas comuns, não administradores.

## Publicar no Render
1. Envie os arquivos para um repositório no GitHub.
2. No Render, crie um **Web Service** conectado ao repositório.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Adicione variáveis `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `SESSION_SECRET` (uma chave aleatória forte).
6. Para persistência em produção, mantenha um disco persistente montado em `/var/data` e `DB_PATH=/var/data/cardapio.db`. O `render.yaml` já descreve essa configuração em planos compatíveis.
7. Configure também `UPLOAD_DIR=/var/data/uploads` para que as imagens enviadas pelo painel persistam no disco. Crie a pasta se necessário; o servidor a cria automaticamente.

**Importante sobre o Render:** o plano gratuito pode não oferecer disco persistente. Sem disco, o banco SQLite e fotos locais podem ser perdidos em reinicializações ou deploys. Para uso real, use um plano com disco persistente ou adapte para um banco gerenciado e armazenamento de imagens externo.

## Funcionalidades
- Produtos e categorias armazenados em SQLite; seis produtos de exemplo são inseridos somente quando o banco está vazio. Edite/substitua no painel.
- Cadastro e login com hash bcrypt e sessão.
- Avaliações de 1 a 5 estrelas e comentário; uma avaliação por usuário por produto.
- Favoritos por usuário.
- Pedidos com itens, total, entrega/retirada, endereço e observações.
- Painel `/admin`: produtos (criar, editar, excluir, foto), pedidos/status, avaliações, clientes e configurações.
- API JSON em `/api`.

## Antes de abrir ao público
- Troque a chave de sessão e use credenciais fortes.
- Configure `ADMIN_EMAIL` e `ADMIN_PASSWORD` nas variáveis privadas do Render.
- Confirme endereço, horários, preços, ingredientes, fotos e política de entrega.
- Configure um canal de pagamento/checkout se desejar pagamento online. O projeto registra pedidos, mas **não cobra pagamentos automaticamente**.
- O recurso de recuperação de senha por e-mail ainda não está integrado.
- Os produtos iniciais são exemplos editáveis; substitua pelos produtos e preços reais da loja.


## Login com Google e permissões
Configure no Render (Environment): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` e `OWNER_EMAIL`. O `GOOGLE_CALLBACK_URL` deve ser `https://SEU-SERVICO.onrender.com/auth/google/callback`; no Google Cloud, adicione essa URL como Authorized redirect URI e a origem `https://SEU-SERVICO.onrender.com` como Authorized JavaScript origin. `OWNER_EMAIL` deve ser o e-mail exato da conta Google do Samuel. Não use apenas o nome de usuário `samuelgomeswx2000`, pois a permissão de dono precisa ser validada pelo e-mail verificado. Depois que o dono entrar, ele pode promover usuários cadastrados a administradores pelo painel.

Para produtos: entre em `/admin` com a conta do dono ou um administrador, abra a aba Produtos e clique em “Novo produto”.
