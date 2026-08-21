from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Role, User
from .permissions import IsOperator
from .serializers import ManagedUserSerializer, SlopTokenObtainPairSerializer, UserSerializer


class LoginView(TokenObtainPairView):
    serializer_class = SlopTokenObtainPairSerializer


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class UserViewSet(viewsets.ModelViewSet):
    """CRUD for application users. Operator (admin) only.

    Operator accounts are protected from other Operators (no edit/delete); only Satpol PP accounts are
    fully manageable. An Operator may edit their own name and password but not their role or status.

    Filters: ``?role=operator|satpol_pp``, ``?is_active=true|false``, ``?search=<text>``.
    """

    serializer_class = ManagedUserSerializer
    permission_classes = [IsOperator]
    pagination_class = None

    def get_queryset(self):
        queryset = User.objects.order_by("username")
        params = self.request.query_params
        if params.get("role") in Role.values:
            queryset = queryset.filter(role=params["role"])
        if "is_active" in params:
            queryset = queryset.filter(is_active=params["is_active"].lower() == "true")
        search = params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search) | Q(first_name__icontains=search) | Q(last_name__icontains=search)
            )
        return queryset

    def get_object(self):
        user = super().get_object()
        # Operators are peers: nobody may edit, demote, deactivate or delete another Operator.
        # Everyone can still edit their own name/password (role and active flag are guarded in the serializer).
        if (
            self.request.method not in SAFE_METHODS
            and user.role == Role.OPERATOR
            and user.pk != self.request.user.pk
        ):
            raise PermissionDenied("Akun Operator lain tidak dapat diubah atau dihapus oleh sesama Operator.")
        return user

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user.pk == request.user.pk:
            return Response({"detail": "Anda tidak dapat menghapus akun Anda sendiri."}, status=status.HTTP_400_BAD_REQUEST)
        is_last_operator = (
            user.role == Role.OPERATOR
            and user.is_active
            and not User.objects.filter(role=Role.OPERATOR, is_active=True).exclude(pk=user.pk).exists()
        )
        if is_last_operator:
            return Response({"detail": "Minimal harus ada satu Operator aktif."}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)
