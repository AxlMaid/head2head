// Relais de parties Head2Head: un Durable Object par code de partie.
// Le serveur ne simule rien: il relaie les messages d'un joueur aux autres.
//
//   wss://<worker>/ws/<CODE>?create=1&max=2   crée la partie (le 1er arrivé = slot 0)
//   wss://<worker>/ws/<CODE>                  rejoint une partie existante
//
// Refus: message {t:"error",code,reason} puis fermeture. Codes: 4404 partie introuvable, 4409 code déjà pris, 4403 partie pleine.
// Messages serveur -> client (JSON texte): {t:"welcome",slot,players,max} | {t:"join",slot,players} | {t:"leave",slot,players}
// Tout autre message (texte ou binaire) est relayé tel quel aux autres joueurs.
// Keepalive: le client envoie le texte "ping", le serveur répond "pong" sans réveiller la partie.

import { DurableObject } from "cloudflare:workers";

const MAX_MSG_BYTES = 8192;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]{4,8})$/);
    if (!m) return new Response("head2head relay OK\n", { headers: { "content-type": "text/plain" } });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket attendu", { status: 426 });
    const code = m[1].toUpperCase();
    return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  live(except) {
    // seuls les joueurs réellement entrés dans la partie (attachment posé) comptent
    return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === WebSocket.OPEN && w.deserializeAttachment()?.slot !== undefined);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const create = url.searchParams.get("create") === "1";
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);

    const others = this.live(server);
    let max;
    let reject = null;

    if (others.length === 0) {
      if (!create) reject = [4404, "partie introuvable"];
      else {
        max = Math.min(4, Math.max(2, parseInt(url.searchParams.get("max") || "2", 10) || 2));
        await this.ctx.storage.put("max", max);
      }
    } else if (create) {
      reject = [4409, "code deja pris"];
    } else {
      max = (await this.ctx.storage.get("max")) || 2;
      if (others.length >= max) reject = [4403, "partie pleine"];
    }

    if (reject) {
      // Un close envoyé avant la réponse 101 n'arrive pas au client: on envoie d'abord la raison en JSON, puis on ferme.
      server.send(JSON.stringify({ t: "error", code: reject[0], reason: reject[1] }));
      this.ctx.waitUntil(new Promise((r) => setTimeout(() => { try { server.close(reject[0], reject[1]); } catch (_) {} r(); }, 100)));
      return new Response(null, { status: 101, webSocket: client });
    }

    const used = new Set(others.map((w) => w.deserializeAttachment()?.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    server.serializeAttachment({ slot });

    const players = others.length + 1;
    server.send(JSON.stringify({ t: "welcome", slot, players, max }));
    for (const w of others) w.send(JSON.stringify({ t: "join", slot, players }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    const size = typeof msg === "string" ? msg.length : msg.byteLength;
    if (size > MAX_MSG_BYTES) return;
    for (const w of this.live(ws)) w.send(msg);
  }

  async gone(ws) {
    const slot = ws.deserializeAttachment()?.slot;
    try { ws.close(1000, "bye"); } catch (_) {}
    if (slot === undefined) return; // connexion refusée: jamais entrée dans la partie
    const rest = this.live(ws);
    if (rest.length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }
    for (const w of rest) w.send(JSON.stringify({ t: "leave", slot, players: rest.length }));
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }
}
