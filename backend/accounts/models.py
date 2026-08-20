from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models


class Role(models.TextChoices):
    OPERATOR = "operator", "Operator (Admin)"
    SATPOL_PP = "satpol_pp", "Satpol PP"


class SlopUserManager(UserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("role", Role.OPERATOR)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """Application user. Authorization is driven by `role` (RBAC)."""

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.SATPOL_PP)

    objects = SlopUserManager()

    @property
    def is_operator(self) -> bool:
        return self.role == Role.OPERATOR

    @property
    def is_satpol_pp(self) -> bool:
        return self.role == Role.SATPOL_PP
