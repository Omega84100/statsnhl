# Stats NHL

Site perso pour les paris NHL entre amis. Toutes les données viennent en direct de l'API officielle de la NHL : rien n'est écrit en dur, donc le site est toujours à jour sans rien faire.

- `public/` : le site (HTML, CSS, JS ; Three.js pour la patinoire 3D).
- `src/nhl-proxy.js` : le petit relais vers l'API NHL et The Odds API (cache, liste blanche des chemins, clé gardée côté serveur).
- `src/worker.js` + `wrangler.jsonc` : hébergement Cloudflare Workers (gratuit).
- `netlify/functions/api.mjs` + `netlify.toml` : même chose pour Netlify.

## Mise à jour automatique

- Scores toutes les 30 s pendant les matchs, statistiques/gardiens/compositions toutes les 10 min, et à chaque retour sur l'onglet.
- Côté serveur, les réponses NHL sont mises en cache (20 s pour les scores, 30 min pour les stats) pour rester dans les quotas gratuits.
- Aucun redéploiement n'est nécessaire pour avoir des données fraîches.

## Cotes (facultatif)

Créer une clé gratuite sur https://the-odds-api.com (plan Starter, 500 crédits/mois), puis l'ajouter comme **secret** nommé `ODDS_API_KEY` :
- Cloudflare : Workers & Pages → statsnhl → Settings → Variables and Secrets → Add → type Secret.
- Netlify : Project configuration → Environment variables → Add a variable.

Les cotes US (médiane des bookmakers) sont converties en décimal, puis on garde 85 % du gain : 2,00 → 1,85. Les cotes d'un match ne sont chargées que quand on ouvre ce match (4 crédits), puis gardées 3 h.

## Tests

```
npm test            # modèle, conversion des cotes, liste blanche du proxy
npm run mock        # site complet sur http://localhost:8787 avec de fausses données NHL
```
