# Signaux crypto

Toutes les heures, ce programme récupère les cours de 10 cryptos (Bitcoin, Ethereum, Solana, XRP, Dogecoin, Cardano, Avalanche, Chainlink, Polkadot, Litecoin), repère les situations notables et calcule ce qui s'est passé les fois précédentes où la même situation est apparue.

- **Tableau de bord** : https://yanniskem.github.io/signaux-crypto/
- **Notifications** : application [ntfy](https://ntfy.sh), sujet indiqué sur le tableau de bord

## Situations suivies

| Situation | Règle |
|---|---|
| Chute / hausse brutale | Variation de plus de 7 % en 24 h |
| Chute / hausse sur la semaine | Variation de plus de 15 % en 7 jours |
| RSI bas / haut | RSI 14 jours sous 30 ou au-dessus de 70 |
| Croisement des moyennes | La moyenne 50 jours passe au-dessus ou en dessous de la 200 jours |
| Plus haut / plus bas | Prix au plus haut ou au plus bas des 90 derniers jours |

Pour chaque situation, l'analyse reprend tout l'historique Coinbase de la crypto, repère chaque début d'épisode (au moins 10 jours d'écart entre deux épisodes) et mesure l'évolution du prix 7 et 30 jours après. Le résultat est comparé à un « jour normal » : la même mesure sur tous les jours de l'historique.

Une situation est dite « plutôt suivie d'une hausse » (ou d'une baisse) quand, à 30 jours, la part de cas en hausse dépasse celle d'un jour normal d'au moins 10 points, avec au moins 8 cas. Sinon : « comme un jour normal » ou « trop peu de cas ».

**Ce sont des statistiques sur le passé, pas des prévisions ni des conseils d'investissement.**

## Fonctionnement

- `scripts/analyse.mjs` : calculs (indicateurs, situations, statistiques)
- `scripts/run.mjs` : récupération des cours (API publique Coinbase), écriture de `docs/data.json`, envoi des notifications
- `scripts/test.mjs` : tests des calculs, lancés avant chaque analyse
- `docs/index.html` : tableau de bord
- `.github/workflows/analyse.yml` : passage toutes les heures sur GitHub Actions, puis publication sur GitHub Pages

L'historique est gardé dans `data/history/`, et `data/state.json` retient les situations déjà notifiées pour ne pas envoyer deux fois la même alerte. Le premier passage enregistre les situations en cours sans notifier.

Le sujet ntfy par défaut est `signaux-crypto-fcadae2e`. Pour en changer, créer la variable `NTFY_TOPIC` du dépôt (Settings → Secrets and variables → Actions → Variables). Pour envoyer une notification de test : onglet Actions → Analyse horaire → Run workflow → cocher « Envoyer une notification de test », ou pousser un commit dont le message contient `[notif-test]`.
