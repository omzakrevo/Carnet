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

- **Activation** : internet est nécessaire.
- **Vérification** : au démarrage et au retour dans l'application (au plus toutes les 6 heures).
- **Sans internet** : l'application continue de marcher **30 jours** après la dernière vérification.
- **Fin de licence** : un bandeau prévient le client **7 jours** avant l'expiration.
- **Blocage** : à l'expiration ou à la suspension, l'application se bloque. **Les données du client ne sont jamais effacées.** Elles reviennent dès que la licence est renouvelée.

Ces durées se règlent dans `config.js`.

## Sécurité : ce qu'il faut savoir

- Les clés ne sont **jamais publiées** : le fichier ne contient que leur empreinte SHA-256. Lire `licences.json` ne permet donc pas de retrouver une clé.
- La vérification se fait dans le navigateur du client. Quelqu'un qui s'y connaît en informatique pourrait la contourner. C'est le compromis d'un système simple, sans serveur : il suffit pour une clientèle de boutiques, pas contre un pirate déterminé.
