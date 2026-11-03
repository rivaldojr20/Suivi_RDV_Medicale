# clinic/management/commands/seed_demo.py
import random
from datetime import datetime, timedelta

from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Center, User
from clinic.constants import TZ, SLOT_MIN, local_to_utc, slot_starts
from clinic.models import Appointment, Patient

LAST = ["RAKOTOARISOA", "RANDRIANASOLO", "RASOANAIVO", "ANDRIAMAMPIANINA", "RAZAFINDRAKOTO",
        "RAKOTOMALALA", "RABEMANANJARA", "RAJAONARISON", "RANDRIAMAHEFA", "RAZAFIMANANA",
        "RAHARIJAONA", "ANDRIANTSOA"]
FIRST = ["Hery", "Miora", "Voahangy", "Faniry", "Tiana", "Lalaina", "Njaka", "Mamy",
         "Fenitra", "Zo", "Haingo", "Toky", "Volatiana", "Rado"]
VILLAGES = ["Ambohimanarina", "Andraharo", "Anosibe", "Ankorondrano", "Isotry", "Analakely",
            "Ambohipo", "Itaosy", "Ivato", "Ampefiloha"]
REASONS = ["Consultation prénatale", "Vaccination", "Fièvre", "Suivi diabète",
           "Contrôle tension", "Planning familial", "Pesée nourrisson"]


class Command(BaseCommand):
    help = "Crée un centre de démo, 4 utilisateurs, 40 patients et des RDV sur 3 jours (idempotent)."

    @transaction.atomic
    def handle(self, *args, **opts):
        rng = random.Random(42)
        center, _ = Center.objects.get_or_create(
            name="CSB II Ambohimanarina (démo)", defaults={"district": "Antananarivo Renivohitra"})

        def user(username, role, first, last, profession="doctor"):
            u, created = User.objects.get_or_create(username=username, defaults=dict(
                first_name=first, last_name=last, role=role, profession=profession, center=center))
            if created:
                u.set_password("demo1234")          # démo uniquement
                u.save()
            return u

        reception = user("accueil", "reception", "Lalaina", "Rakotonirina")
        dr = user("dr_miora", "practitioner", "Miora", "Rasoanaivo", "doctor")
        sf = user("sf_voahangy", "practitioner", "Voahangy", "Razafindrabe", "midwife")

        if Patient.objects.exists():
            self.stdout.write("Données déjà présentes : patients/RDV non recréés.")
            return

        Patient.objects.bulk_create([
            Patient(center=center, created_by=reception,
                    last_name=rng.choice(LAST), first_name=rng.choice(FIRST),
                    sex=rng.choice("MF"), birth_year=rng.randint(1950, 2023),
                    phone=f"03{rng.choice([2, 3, 4])} {rng.randint(10, 99)} "
                          f"{rng.randint(100, 999)} {rng.randint(10, 99)}",
                    village=rng.choice(VILLAGES))
            for _ in range(40)
        ])
        patients = list(Patient.objects.all())

        today = datetime.now(TZ).date()
        appts = []
        for offset in range(3):
            day = today + timedelta(days=offset)
            for practitioner in (dr, sf):
                for start in rng.sample(list(slot_starts()), 5):   # créneaux distincts : aucun chevauchement
                    appts.append(Appointment(
                        center=center, created_by=reception,
                        patient=rng.choice(patients), practitioner=practitioner,
                        scheduled_at=local_to_utc(day, start), duration_min=SLOT_MIN,
                        reason=rng.choice(REASONS), status="planned"))
        Appointment.objects.bulk_create(appts)
        self.stdout.write(self.style.SUCCESS(f"OK : {len(patients)} patients, {len(appts)} RDV."))