#!/usr/bin/env python3
"""SAMP Пульс: один снимок публичного списка серверов open.mp.

Запускается по расписанию из GitHub Actions (можно и руками локально).
Пишет файлы данных в текущую папку:

  live_min.json          компактный снимок всех серверов (запасной источник для сайта)
  online-YYYY-MM.jsonl   одна строка на снимок: сколько всего играет и т.д.
  servers.json           почасовая история по активным серверам (среднее и пик)
  meta.json              когда был последний снимок и короткая сводка

Зависимостей нет, только стандартная библиотека.
"""
import datetime
import json
import os
import sys
import time
import urllib.request

API = "https://api.open.mp/servers"
UA = "SAMP-Pulse/0.1 (+https://github.com/hilsetapp/samp-pulse)"
KEEP_HOURS = 36          # сколько часов держим почасовую историю
KEEP_MONTHS = 6          # сколько месяцев держим файлы online-*.jsonl
MAX_SERVERS = 500        # максимум серверов в почасовой истории
MIN_PEAK = 2             # минимальный пик игроков, чтобы сервер попал в историю
HOUR = 3600


def log(*a):
    print("[snapshot]", *a, flush=True)


def fetch_servers():
    req = urllib.request.Request(API, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def is_russian(lang):
    l = (lang or "").lower()
    return "russian" in l or "русск" in l or l.strip() == "ru"


def main():
    try:
        raw = fetch_servers()
    except Exception as e:  # API мигнул - это не повод красить экшен в красный
        log("API недоступен:", e)
        sys.exit(0)

    now = int(time.time())
    log("серверов пришло:", len(raw))

    # ---------- 1) компактный снимок ----------
    compact = []
    for s in raw:
        ip = s.get("ip")
        if not ip:
            continue
        compact.append([
            ip,
            (s.get("hn") or "").strip(),
            int(s.get("pc") or 0),
            int(s.get("pm") or 0),
            (s.get("gm") or "").strip(),
            (s.get("la") or "").strip(),
            1 if s.get("pa") else 0,
            1 if s.get("omp") else 0,
            (s.get("vn") or "").strip(),
            1 if s.get("pr") else 0,
        ])
    with open("live_min.json", "w", encoding="utf-8") as f:
        json.dump({"t": now, "s": compact}, f, ensure_ascii=False, separators=(",", ":"))

    # ---------- 2) строка в online-YYYY-MM.jsonl ----------
    total_players = sum(c[2] for c in compact)
    active = sum(1 for c in compact if c[2] > 0)
    ru = [c for c in compact if is_russian(c[5])]
    ru_players = sum(c[2] for c in ru)
    line = {"t": now, "p": total_players, "s": active, "ru": ru_players, "rs": len(ru)}

    month_file = "online-%s.jsonl" % datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime("%Y-%m")
    with open(month_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n")

    # ---------- 3) почасовая история по серверам ----------
    try:
        hist = json.load(open("servers.json", encoding="utf-8"))
        if not isinstance(hist, dict):
            hist = {}
    except Exception:
        hist = {}

    hour_ts = now - (now % HOUR)
    for c in compact:
        ip, name, pc, _pm = c[0], c[1], c[2], c[3]
        rec = hist.get(ip) or {"n": name, "b": [], "seen": 0}
        rec["seen"] = now
        if name:
            rec["n"] = name
        buckets = rec["b"]
        if buckets and buckets[-1][0] == hour_ts:
            b = buckets[-1]
            b[1] += pc          # сумма
            b[2] += 1           # число замеров
            b[3] = max(b[3], pc)  # пик
        else:
            buckets.append([hour_ts, pc, 1, pc])
        rec["b"] = [b for b in buckets if b[0] >= now - KEEP_HOURS * HOUR]
        hist[ip] = rec

    # чистим: давно не виделись и пустая история
    hist = {ip: r for ip, r in hist.items() if r["b"]}
    if len(hist) > MAX_SERVERS:
        hist = dict(sorted(hist.items(), key=lambda kv: -max(b[3] for b in kv[1]["b"]))[:MAX_SERVERS])

    with open("servers.json", "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))

    # ---------- 4) meta ----------
    meta = {"updated": now, "interval_min": 15, "servers": len(compact),
            "players": total_players, "active": active, "ru_players": ru_players, "ru_servers": len(ru)}
    with open("meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    # ---------- 5) чистим старые месяцы ----------
    cutoff = datetime.datetime.fromtimestamp(now, datetime.timezone.utc) - datetime.timedelta(days=KEEP_MONTHS * 31)
    for fn in os.listdir("."):
        if fn.startswith("online-") and fn.endswith(".jsonl"):
            try:
                d = datetime.datetime.strptime(fn[7:14], "%Y-%m")
                if d < cutoff:
                    os.remove(fn)
                    log("удалил старый файл:", fn)
            except Exception:
                pass

    log("игроков всего: %d, активных серверов: %d, RU: %d игроков на %d серверах" % (total_players, active, ru_players, len(ru)))
    log("готово")


if __name__ == "__main__":
    main()
