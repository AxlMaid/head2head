// Usage: node test/relay.test.mjs ws://localhost:8787   (ou wss://head2head-relay.<compte>.workers.dev)
const base = process.argv[2] || "ws://localhost:8787";
const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };

function open(path) {
  return new Promise((res) => {
    const ws = new WebSocket(base + path);
    ws.msgs = []; ws.waiters = [];
    ws.addEventListener("message", (e) => { ws.msgs.push(e.data); ws.waiters.splice(0).forEach((f) => f()); });
    ws.addEventListener("open", () => { ws.opened = true; res(ws); });
    ws.addEventListener("close", (e) => { ws.closed = { code: e.code, reason: e.reason }; ws.waiters.splice(0).forEach((f) => f()); if (!ws.opened) res(ws); });
  });
}
const next = (ws, ms = 3000) => new Promise((res) => {
  if (ws.msgs.length) return res(ws.msgs.shift());
  const f = () => { clearTimeout(t); res(ws.msgs.shift() ?? null); };
  const t = setTimeout(() => { ws.waiters = ws.waiters.filter((x) => x !== f); res(null); }, ms);
  ws.waiters.push(f);
});
const waitClose = (ws, ms = 3000) => new Promise((res) => {
  if (ws.closed) return res(ws.closed);
  const t = setTimeout(() => res(null), ms);
  ws.waiters.push(() => { clearTimeout(t); res(ws.closed ?? null); });
});

// rejoindre une partie inexistante
const ghost = await open(`/ws/${code}`);
ok(JSON.parse(await next(ghost))?.code === 4404, "rejoindre un code inexistant -> 4404");

// créer
const a = await open(`/ws/${code}?create=1&max=2`);
const wa = JSON.parse(await next(a));
ok(wa.t === "welcome" && wa.slot === 0 && wa.players === 1 && wa.max === 2, "créateur: welcome slot 0");

// code déjà pris
const dup = await open(`/ws/${code}?create=1`);
ok(JSON.parse(await next(dup))?.code === 4409, "créer un code déjà pris -> 4409");

// rejoindre
const b = await open(`/ws/${code}`);
const wb = JSON.parse(await next(b));
ok(wb.t === "welcome" && wb.slot === 1 && wb.players === 2, "invité: welcome slot 1");
const ja = JSON.parse(await next(a));
ok(ja.t === "join" && ja.slot === 1 && ja.players === 2, "hôte notifié du join");

// partie pleine
const c = await open(`/ws/${code}`);
ok(JSON.parse(await next(c))?.code === 4403, "3e joueur -> 4403 partie pleine");

// relais texte + binaire
a.send(JSON.stringify({ t: "puck", x: 1 }));
ok(JSON.parse(await next(b)).t === "puck", "texte relayé A -> B");
b.send(new Uint8Array([1, 2, 3]));
const bin = await next(a);
ok(bin && new Uint8Array(bin instanceof Blob ? await bin.arrayBuffer() : bin).length === 3, "binaire relayé B -> A");

// pas d'écho vers l'émetteur
a.send("x");
ok((await next(a, 400)) === null, "pas d'écho vers l'émetteur");

// keepalive
a.send("ping");
ok((await next(a)) === "pong", "ping -> pong");

// latence aller-retour A -> B -> A
const rtts = [];
for (let i = 0; i < 10; i++) {
  const t0 = performance.now();
  a.send("p" + i); await next(b);
  b.send("q" + i); await next(a);
  rtts.push(performance.now() - t0);
}
console.log("INFO aller-retour via relais (A->B->A) ms: min", Math.min(...rtts).toFixed(0), "médiane", rtts.sort((x, y) => x - y)[5].toFixed(0));

// départ
b.close();
const lv = JSON.parse(await next(a));
ok(lv.t === "leave" && lv.slot === 1 && lv.players === 1, "hôte notifié du départ");

a.close();
console.log(fails ? `\n${fails} ÉCHEC(S)` : "\nTout est OK");
process.exit(fails ? 1 : 0);
