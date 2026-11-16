// Réglages de l'application
window.CARNET_CONFIG = {
  // Fichier des licences, publié sur GitHub (dépôt public).
  // Pour ajouter / renouveler / suspendre un client : modifiez licences.json sur GitHub (voir LICENCES.md).
  licenceUrl: 'https://raw.githubusercontent.com/omzakrevo/Carnet/main/licences.json',

  // Nombre de jours pendant lesquels l'application marche sans internet après la dernière vérification
  horsLigneMaxJours: 30,

  // Un bandeau prévient le client quand sa licence expire dans moins de N jours
  alerteJours: 7,

  // L'application revérifie la licence au plus tôt toutes les N heures (au démarrage et au retour dans l'appli)
  verifHeures: 6,

  // Paiement en ligne (SasPay). Le prix réellement facturé est fixé côté serveur (variable PRIX_MOIS sur Vercel).
  paiementActif: true,
  prixMois: 1000,

  // Essai gratuit après l'inscription (en heures). Doit être identique à ESSAI_HEURES sur Vercel (24 par défaut).
  essaiHeures: 24,

  // Dépôt GitHub PRIVÉ où sont enregistrés les comptes (même propriétaire que le dépôt des licences)
  comptesRepo: 'carnet-comptes'
};
