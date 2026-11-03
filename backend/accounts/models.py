from django.db import models
import uuid
from django.contrib.auth.models import AbstractUser, UserManager as DjangoUserManager

# Create your models here.
class Center(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    district = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "centers"

    def __str__(self):
        return self.name

class UserManager(DjangoUserManager):
    def create_superuser(self, username, email=None, password=None, **extra):
        extra.setdefault("role", "admin")     # createsuperuser crée un vrai admin
        return super().create_superuser(username, email, password, **extra)

class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Administrateur"
        RECEPTION = "reception", "Accueil"
        PRACTITIONER = "practitioner", "Praticien"

    class Profession(models.TextChoices):
        DOCTOR = "doctor", "Médecin"
        MIDWIFE = "midwife", "Sage-femme"
        NURSE = "nurse", "Infirmier(ère)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(max_length=15, choices=Role.choices, default=Role.RECEPTION)
    profession = models.CharField(max_length=20, choices=Profession.choices, default=Profession.DOCTOR)
    center = models.ForeignKey(Center, null=True, blank=True, on_delete=models.PROTECT, related_name="users")

    objects = UserManager()

    class Meta:
        constraints = [
            # seul un admin peut ne pas avoir de centre
            models.CheckConstraint(
                condition=models.Q(role="admin") | models.Q(center__isnull=False),
                name="ck_user_center_required",
            ),
        ]

    @property
    def full_name(self):
        return f"{self.last_name} {self.first_name}".strip() or self.username
