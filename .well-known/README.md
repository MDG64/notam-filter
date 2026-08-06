# assetlinks.json — Digital Asset Links pour la TWA Android

Ce fichier lie le domaine `notam.feyndev.com` à l'application Android : sans
lui — ou avec une mauvaise empreinte — la TWA s'ouvre **avec la barre d'URL
Chrome visible**, sans aucune erreur nulle part. C'est le symptôme à
reconnaître.

L'empreinte actuelle est un **placeholder** (que des zéros), posé avant le
premier dépôt sur Play. À remplacer par la vraie, en deux temps :

1. **`package_name`** doit être exactement l'`applicationId` donné à
   Bubblewrap (`com.feyndev.notamlens` — si un autre id est choisi au moment
   du `bubblewrap init`, changer les DEUX au même moment).
2. **`sha256_cert_fingerprints`** : après le premier upload de l'AAB, relever
   l'empreinte dans la **Play Console → Configuration → Signature d'application
   → Certificat de clé de signature d'application** (Play App Signing).
   ⚠️ PAS l'empreinte de la clé locale d'upload générée par Bubblewrap :
   Google re-signe l'AAB avec sa propre clé, et c'est CELLE-LÀ que l'appareil
   vérifie en production. On peut lister les deux empreintes (locale + Play)
   dans le tableau pour que le build de test local passe aussi en plein écran.

Vérification une fois en ligne :
https://developers.google.com/digital-asset-links/tools/generator
(ou `curl https://notam.feyndev.com/.well-known/assetlinks.json`).
