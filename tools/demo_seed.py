#!/usr/bin/env python3
"""Наполняет data-demo/ правдоподобной историей - только для локального
просмотра, пока настоящая история ещё не накопилась. На боевом сайте
история реальная: её пишет tools/snapshot.py из GitHub Actions."""
import json, math, os, random, shutil, time

SRC = "data-seed"
DST = "data-demo"
HOUR = 3600
random.seed(42)

os.makedirs(DST, exist_ok=True)

# 1) живой снимок - реальный
shutil.copy(os.path.join(SRC, "live_min.json"), os.path.join(DST, "live_min.json"))
live = json.load(open(os.path.join(SRC, "live_min.json"), encoding="utf-8"))
now = int(time.time())

def curve(ts):
    """суточная волна: вечером больше (по мск), днём средне, утром мало"""
    h = time.gmtime(ts).tm_hour + 3
    return 0.55 + 0.45 * math.sin((h - 9) / 24 * 2 * math.pi)

# 2) онлайн за 40 часов точками по 15 минут
total_now = sum(c[2] for c in live["s"])
ru_now = sum(c[2] for c in live["s"] if "russian" in (c[5] or "").lower() or "русск" in (c[5] or "").lower())
month = time.strftime("%Y-%m", time.gmtime(now))
with open(os.path.join(DST, f"online-{month}.jsonl"), "w", encoding="utf-8") as f:
    for t in range(now - 40 * HOUR, now + 1, 15 * 60):
        k = curve(t) / curve(now)
        p = int(total_now * k * random.uniform(0.97, 1.03))
        ru = int(ru_now * k * random.uniform(0.95, 1.05))
        f.write(json.dumps({"t": t, "p": p, "s": int(330 * k * random.uniform(0.96, 1.04)),
                            "ru": ru, "rs": int(149 * k * random.uniform(0.96, 1.04))}, separators=(",", ":")) + "\n")

# 3) почасовая история для серверов с игроками
servers = sorted([c for c in live["s"] if c[2] > 0], key=lambda c: -c[2])[:250]
hist = {}
for c in servers:
    ip, name, pc = c[0], c[1], c[2]
    buckets = []
    for h in range(36, -1, -1):
        ht = (now - h * HOUR) - ((now - h * HOUR) % HOUR)
        k = curve(ht) / curve(now)
        peak = max(1, int(pc * k * random.uniform(0.9, 1.15)))
        n = 4
        avg = max(1, int(peak * random.uniform(0.75, 0.95)))
        buckets.append([ht, avg * n, n, peak])
    hist[ip] = {"n": name, "b": buckets, "seen": now}
with open(os.path.join(DST, "servers.json"), "w", encoding="utf-8") as f:
    json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))

json.dump({"updated": now, "interval_min": 15, "servers": len(live["s"]), "players": total_now,
           "active": sum(1 for c in live["s"] if c[2] > 0), "ru_players": ru_now,
           "ru_servers": sum(1 for c in live["s"] if "russian" in (c[5] or "").lower())},
          open(os.path.join(DST, "meta.json"), "w"), ensure_ascii=False)

print("demo data ready:", len(live["s"]), "servers,", len(hist), "with history")
