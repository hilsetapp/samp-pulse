[English](README.md) | [Русский](README.ru.md) | **Español** | [Português](README.pt.md)

# Pulso SA-MP

Jugadores en vivo de los servidores SA-MP y open.mp. Una sola pagina, mas de 1200 servidores, historial de 24 horas, filtros y busqueda. Sin registro, sin anuncios, sin paso de compilacion.

**En vivo:** https://hilsetapp.github.io/samp-pulse/

## Que muestra

- Jugadores conectados ahora mismo en cada servidor: jugadores y plazas.
- Top 5 de servidores por jugadores y grafico del total del dia.
- Historial por servidor: como cambio la poblacion durante el dia.
- Filtros por idioma, pais y modo de juego, busqueda por nombre o IP.
- Favoritos (guardados en tu navegador) y copiar la IP con un clic.
- Enlace directo a un servidor: `https://hilsetapp.github.io/samp-pulse/#s=IP:puerto`
  Ejemplo: `#s=127.0.0.1:7777` abre la ficha de ese servidor.
- La pagina intenta primero la API en vivo y usa la ultima instantanea si la API va lenta o esta bloqueada.

## De donde salen los datos

1. El navegador pide `api.open.mp/servers` para la lista actual.
2. Un GitHub Action ejecuta `tools/snapshot.py` cada 15 minutos y guarda el resultado en la rama `data`.
3. La compilacion del sitio copia esa instantanea junto a la pagina, asi que siempre hay una copia en el mismo origen: `live_min.json`, `servers.json`, `online-YYYY-MM.jsonl`, `meta.json`.
4. Si la API en vivo no responde (algunos proveedores la bloquean), la pagina sigue funcionando con la instantanea e indica arriba cuando se tomo.

El historial se escribe como una linea cada 15 minutos, asi que con el tiempo el proyecto crea su propio conjunto de datos abierto del online de SA-MP. La rama `data` es publica.

## Ejecutar en local

```
git clone https://github.com/hilsetapp/samp-pulse.git
cd samp-pulse
python -m http.server 8080
```

Abre http://localhost:8080 . Sin npm ni empaquetador: HTML, CSS y JavaScript puros. Python solo hace falta para la herramienta de instantaneas.

## Tu propia copia (fork)

1. Haz un fork del repositorio.
2. Settings -> Pages -> Source: GitHub Actions.
3. Actions -> "snapshot" -> Run workflow. La primera ejecucion llena la rama `data` y el sitio.
4. Tu sitio quedara en `https://TU-USUARIO.github.io/samp-pulse/`.

## Estructura

```
index.html              la pagina
js/app.js               toda la logica: descarga, respaldo, filtros, historial, grafico
tools/snapshot.py       toma la lista de open.mp y escribe los archivos de datos
tools/demo_seed.py      genera datos de demostracion
data-seed/              archivos de datos de ejemplo
.github/workflows/      la tarea de instantanea cada 15 minutos
```

## Datos y privacidad

- Favoritos y el ultimo servidor abierto se quedan en `localStorage`, nada se envia a ningun lado.
- Sin cookies, sin analitica, sin cuentas.
- Nombres, IPs y recuento de jugadores son datos publicos de open.mp.

## Licencia

MIT.
