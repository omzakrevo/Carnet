# Carnet de gestion des ventes

La version numérique du carnet papier « Suivi des ventes » : une application web pour téléphone, qui marche **hors connexion** et s'installe comme une vraie application (PWA).

## Fonctionnalités

- **Ventes** : une page par jour, comme dans le carnet. Colonnes : heure, nom et numéro du client, produit, quantité, prix unitaire, prix total (calculé automatiquement), mode de paiement (Espèces, Orange Money, Moov Money, Wave, Virement, Crédit…), mode de remise (sur place, livraison…) et observations.
  En haut de la page : **nombre de ventes**, **chiffre d'affaires** et **ventes à crédit** du jour.
- **Dépenses** : achats de stock, transport, loyer, publicité… regroupés par mois.
- **Crédits** : la liste des clients qui doivent encore de l'argent, avec un bouton pour les appeler et un bouton « Encaisser » (paiement en une ou plusieurs fois).
- **Bilan du mois** : chiffre d'affaires, dépenses, bénéfice, montant encaissé, ventes par jour, meilleurs produits, répartition par mode de paiement.
- **Profil** : nom de la marque, responsable, contacts, réseaux sociaux, devise (FCFA par défaut).
- **Export** vers Excel (CSV), **sauvegarde et restauration** (fichier JSON), **impression** de la page du jour.
- Saisie rapide : l'application propose les clients et produits déjà enregistrés, et remplit d'elle-même le numéro du client et le dernier prix du produit.

Les données sont enregistrées **sur le téléphone** (localStorage). Pensez à télécharger une sauvegarde de temps en temps.

## Lancer en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mettre en ligne

Le site est fait de fichiers statiques (aucun serveur à prévoir). On peut l'héberger sur GitHub Pages, Netlify ou Vercel. Une fois le site ouvert sur le téléphone : menu du navigateur → « Ajouter à l'écran d'accueil ».
