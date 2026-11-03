# syncapi/rules.py
ENTITIES_BY_ROLE = {
    "reception":    ("patients", "appointments"),                       # jamais de notes cliniques
    "practitioner": ("patients", "appointments", "consultation_notes"),
}

def allowed_entities(user):
    return ENTITIES_BY_ROLE.get(user.role, ())

# Un praticien ne peut que changer le statut d'un RDV (matrice des droits §1.4).
# Pour l'autoriser à créer des RDV de suivi, il suffit de relâcher cette fonction.
PRACTITIONER_APPT_FIELDS = {"status"}


def check_appointment_rights(user, creating, action, clean):
    """Retourne un message d'erreur, ou None si l'écriture est autorisée."""
    if user.role != "practitioner":
        return None
    if creating or action == "DELETE" or set(clean) - PRACTITIONER_APPT_FIELDS:
        return "Un praticien ne peut que changer le statut d'un RDV."
    return None