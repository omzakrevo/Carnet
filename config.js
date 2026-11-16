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
  verifHeures: 6
};
