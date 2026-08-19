from rest_framework.permissions import BasePermission

from .models import Role


class IsOperator(BasePermission):
    """Full management access: device CRUD, dynamic unit setup, global parameters."""

    message = "Hanya Operator yang dapat melakukan tindakan ini."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == Role.OPERATOR)


class IsSatpolPP(BasePermission):
    """Field officers: monitoring dashboard and alert logs."""

    message = "Hanya petugas Satpol PP yang dapat melakukan tindakan ini."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == Role.SATPOL_PP)


class IsMonitoringUser(BasePermission):
    """Read access to monitoring data: both roles (Operators also need to watch the fleet)."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in (Role.OPERATOR, Role.SATPOL_PP))
