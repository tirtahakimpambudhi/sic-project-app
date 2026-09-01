from rest_framework.permissions import BasePermission

from core.models import UserRole


class _HasRole(BasePermission):
    role: str

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.role == self.role)


class IsOperator(_HasRole):
    role = UserRole.OPERATOR


class IsSatpolPP(_HasRole):
    role = UserRole.SATPOL_PP
