# Relais Head2Head (Cloudflare Workers + Durable Objects)

Un Durable Object par partie (code à 4 caractères). Il relaie les messages entre joueurs, sans simuler le jeu.

## Protocole
- Créer : `wss://HOTE/ws/CODE?create=1&max=2` (max 2 à 4 joueurs). Le premier arrivé a le slot 0.
- Rejoindre : `wss://HOTE/ws/CODE`
- Refus : message `{t:"error",code,reason}` puis fermeture. `4404` introuvable, `4409` code déjà pris (en générer un autre), `4403` pleine.
- Serveur -> client (JSON) : `welcome {slot,players,max}`, `join {slot,players}`, `leave {slot,players}`.
- Tout autre message, texte ou binaire (8 Ko max), est relayé tel quel aux autres joueurs. Les clients y mettent leur propre slot si besoin.
- Keepalive : envoyer le texte `ping` toutes les ~20 s, réponse `pong`.

## Développement
```
cd relay
npm install
npx wrangler login     # ouvre le navigateur, à faire une fois
npx wrangler dev       # test local sur ws://localhost:8787
npx wrangler deploy    # publie sur https://head2head-relay.<compte>.workers.dev
```
