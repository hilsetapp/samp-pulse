[Русский](README.md) | [English](README.en.md) | [Español](README.es.md) | **Português**

# Pulso SA-MP

Jogadores ao vivo dos servidores SA-MP e open.mp. Uma pagina so, mais de 1200 servidores, historico de 24 horas, filtros e busca. Sem login, sem anuncios, sem etapa de build.

**Ao vivo:** https://hilsetapp.github.io/samp-pulse/

## O que mostra

- Jogadores online agora em cada servidor: jogadores e vagas.
- Top 5 servidores por jogadores e grafico do total do dia.
- Historico por servidor: como a populacao mudou ao longo do dia.
- Filtros por idioma, pais e modo de jogo, busca por nome ou IP.
- Favoritos (salvos no navegador) e copiar o IP com um clique.
- Link direto para um servidor: `https://hilsetapp.github.io/samp-pulse/#s=IP:porta`
  Exemplo: `#s=127.0.0.1:7777` abre o cartao desse servidor.
- A pagina tenta a API ao vivo primeiro e usa o ultimo snapshot se a API estiver lenta ou bloqueada.

## De onde vem os dados

1. O navegador pede `api.open.mp/servers` para a lista atual.
2. Um GitHub Action roda `tools/snapshot.py` a cada 15 minutos e grava na branch `data`.
3. O build do site copia esse snapshot junto da pagina, entao sempre existe uma copia na mesma origem: `live_min.json`, `servers.json`, `online-YYYY-MM.jsonl`, `meta.json`.
4. Se a API ao vivo nao responde (alguns provedores bloqueiam), a pagina continua com o snapshot e mostra no topo quando ele foi feito.

## Rodar localmente

```
git clone https://github.com/hilsetapp/samp-pulse.git
cd samp-pulse
python -m http.server 8080
```

Abra http://localhost:8080 . Sem npm e sem bundler: HTML, CSS e JavaScript puros. O Python so e necessario para a ferramenta de snapshot.

## Sua propria copia (fork)

1. Faca um fork do repositorio.
2. Settings -> Pages -> Source: GitHub Actions.
3. Actions -> "snapshot" -> Run workflow. A primeira execucao preenche a branch `data` e o site.
4. Seu site fica em `https://SEU-NOME.github.io/samp-pulse/`.

## Estrutura

```
index.html              a pagina
js/app.js               toda a logica: download, fallback, filtros, historico, grafico
tools/snapshot.py       pega a lista do open.mp e grava os arquivos de dados
tools/demo_seed.py      gera dados de demonstracao
data-seed/              arquivos de dados de exemplo
.github/workflows/      a tarefa de snapshot a cada 15 minutos
```

## Dados e privacidade

- Favoritos e o ultimo servidor aberto ficam no `localStorage`, nada e enviado para fora.
- Sem cookies, sem analytics, sem contas.
- Nomes, IPs e contagem de jogadores sao dados publicos do open.mp.

## Licenca

MIT.
