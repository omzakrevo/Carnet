# Gérer les licences

L'application demande une **clé de licence** au premier lancement. Les licences sont dans le fichier
[`licences.json`](licences.json) de ce dépôt GitHub. L'application le lit à cette adresse (réglée dans `config.js`) :

```
https://raw.githubusercontent.com/omzakrevo/Carnet/main/licences.json
```

Il n'y a pas de serveur ni de base de données à gérer : **pour vendre, renouveler ou couper une licence, on modifie ce fichier sur GitHub.**

## Vendre une licence à un client

1. Ouvrez la page **`/admin.html`** de l'application (par exemple `https://carnet-ventes.vercel.app/admin.html`).
2. Saisissez le nom de la boutique, son téléphone et la durée, puis cliquez **Générer la clé**.
3. **Notez la clé** (`CARNET-XXXX-XXXX-XXXX`) : elle ne s'affiche qu'une fois.
4. Cliquez **Ajouter au fichier**, puis **Copier le fichier**.
5. Cliquez **Ouvrir licences.json sur GitHub** : sélectionnez tout le contenu, collez, puis **Commit changes**.
6. Envoyez la clé au client. Elle marche environ **5 minutes** après l'enregistrement sur GitHub (délai de mise à jour de GitHub).

Le client saisit la clé dans l'application. Le nom et le téléphone de sa boutique remplissent alors son profil.

## Renouveler, suspendre, supprimer

Dans `/admin.html`, la liste des licences propose les boutons **+1 mois**, **+1 an**, **Suspendre / Réactiver** et **Supprimer**.
Ensuite, copiez le fichier et collez-le sur GitHub, comme ci-dessus.

Vous pouvez aussi modifier `licences.json` directement sur GitHub :

| Champ       | Rôle                                                           |
|-------------|----------------------------------------------------------------|
| `boutique`  | Nom de la boutique (affiché dans l'application du client)      |
| `telephone` | Téléphone de la boutique                                       |
| `hash`      | Empreinte de la clé (ne pas modifier)                          |
| `expire`    | Date de fin `AAAA-MM-JJ`, ou `""` pour une licence sans limite |
| `actif`     | `false` pour bloquer l'application tout de suite               |
| `note`      | Libre (paiement, remarque…)                                    |

La partie `vendeur` contient **votre nom et votre numéro**. Ils s'affichent sur l'écran de blocage, avec des boutons Appeler et WhatsApp, pour que le client vous contacte.

## Comportement côté client

- **Essai gratuit** : au premier lancement, la personne peut essayer l'application **24 heures** sans payer (bouton « Essayer gratuitement »). Un bandeau affiche le temps restant. Ensuite l'application se bloque jusqu'au paiement, sans effacer les données saisies. La durée se règle dans `config.js` (`essaiHeures`, `0` pour désactiver).
- **Activation** : internet est nécessaire.
- **Vérification** : au démarrage et au retour dans l'application (au plus toutes les 6 heures).
- **Sans internet** : l'application continue de marcher **30 jours** après la dernière vérification.
- **Fin de licence** : un bandeau prévient le client **7 jours** avant l'expiration.
- **Blocage** : à l'expiration ou à la suspension, l'application se bloque. **Les données du client ne sont jamais effacées.** Elles reviennent dès que la licence est renouvelée.

Ces durées se règlent dans `config.js`.

## Sécurité : ce qu'il faut savoir

- Les clés ne sont **jamais publiées** : le fichier ne contient que leur empreinte SHA-256. Lire `licences.json` ne permet donc pas de retrouver une clé.
- L'essai gratuit est mémorisé sur le téléphone : une personne qui efface les données de son navigateur peut relancer un essai, mais elle perd alors aussi toutes ses ventes.
- La vérification se fait dans le navigateur du client. Quelqu'un qui s'y connaît en informatique pourrait la contourner. C'est le compromis d'un système simple, sans serveur : il suffit pour une clientèle de boutiques, pas contre un pirate déterminé.

## Paiement en ligne (SasPay) : 1 000 FCFA / mois

Sur l'écran de licence, le client touche **Payer mon abonnement**. Il saisit le nom de sa boutique et son numéro, puis choisit 1, 3, 6 ou 12 mois. Il paie sur la page sécurisée de SasPay (Orange Money, Moov Money, carte).
À son retour dans l'application :

1. le serveur (`api/confirm.js`) vérifie auprès de SasPay que le paiement a réussi ;
2. il crée la licence dans `licences.json` sur GitHub (ou la prolonge, pour un renouvellement) ;
3. le client reçoit sa clé à l'écran et l'application se débloque.

Le client peut aussi prolonger son abonnement depuis ⚙️ → Licence → **Prolonger mon abonnement**, ou en touchant le bandeau qui annonce l'expiration.
Si le client ferme la page après avoir payé, le paiement est confirmé à la prochaine ouverture de l'application sur le même téléphone.

### Réglages sur Vercel (Settings → Environment Variables)

| Variable             | Valeur                                                                                                                          |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------|
| `SASPAY_API_KEY`     | Votre clé secrète SasPay `sk_live_…` (tableau de bord SasPay → clés API, droit PAYIN)                                           |
| `GITHUB_TOKEN`       | Jeton GitHub « fine-grained » limité au dépôt `omzakrevo/Carnet`, avec la permission **Contents : Read and write**              |
| `LICENCE_SECRET`     | Texte secret aléatoire : il sert à fabriquer les clés et à signer les commandes. **Ne jamais le changer** une fois en service.   |
| `PRIX_MOIS`          | Facultatif, `1000` par défaut                                                                                                   |
| `COMMISSION_PARRAIN` | Facultatif, `0.25` par défaut (25 %)                                                                                            |

Après avoir ajouté ou modifié une variable, il faut redéployer.

⚠️ SasPay n'a pas de vrai mode test : une clé `sk_test_` débite de l'argent réel. Pour tester, faites un vrai paiement de 1 000 FCFA.

## Parrains (revendeurs) : 25 % de chaque paiement

1. Dans `/admin.html`, section **Parrains**, ajoutez le parrain (nom et code). Enregistrez sur GitHub.
2. Donnez-lui son lien : `https://carnet-ventes.vercel.app/?ref=CODE`.
3. Une boutique qui ouvre ce lien garde le code en mémoire. Le code est aussi pré-rempli dans le formulaire de paiement.
4. À chaque paiement de cette boutique, y compris les renouvellements, `commissions.json` reçoit 25 % du montant.
5. Le parrain suit ses gains sur **`/parrain.html`** : nombre de clients, montant à recevoir, montant déjà reçu.
6. Vous lui envoyez son argent (Orange Money…), puis vous cliquez **Marquer payé** dans `/admin.html` et enregistrez sur GitHub.

Le versement aux parrains n'est **pas automatique** : SasPay n'autorise les virements sortants que depuis une adresse IP déclarée, ce que Vercel ne fournit pas.

## Ce qui est public

Le dépôt GitHub est public : tout le monde peut lire `licences.json`, `parrains.json` et `commissions.json`.
On y trouve les noms des boutiques et des parrains, les dates d'expiration et les montants des commissions.
Les clés, elles, ne sont jamais publiées (seulement leur empreinte), et les paiements n'enregistrent pas le téléphone des clients.
N'ajoutez pas de numéros de téléphone dans ces fichiers si vous voulez les garder privés.
